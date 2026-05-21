import {
  existsSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'fs';
import { join, basename } from 'path';
import { parseRepoString } from '../repo-string';
import { assertSafeRepoPath } from '../repo-file';
import { getOrCreateSnapshot, type CachePlatform } from '../cache';
import { getGitProvider } from '../git-providers/registry';
import { getManagedRegistriesDir } from '../config';
import type { AuthenticatedFetch } from '../authenticated-fetch';
import type { RegistrySourceType } from '../../types/database';
import type { RegistryAdapter, RegistryManifest } from '../../types/registry';

const ADAPTER_EXTENSIONS = ['.ts', '.js', '.mjs'] as const;
const ADAPTER_BASENAMES = ADAPTER_EXTENSIONS.map((ext) => `adapter${ext}`);

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/i;

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

export function deriveSlug(source: string, type: RegistrySourceType): string {
  if (type === 'url') {
    let u: URL;
    try {
      u = new URL(source);
    } catch {
      return 'registry';
    }
    const base = basename(u.pathname);
    const dot = base.lastIndexOf('.');
    const name = dot > 0 ? base.slice(0, dot) : base;
    return name || 'registry';
  }
  const parsed = parseRepoString(source);
  if (parsed.mode === 'search') return parsed.target;
  return basename(parsed.target);
}

export interface RegistryInstallInput {
  slug: string;
  type: RegistrySourceType;
  source: string;
}

export interface RegistryInstallResult {
  resolvedRef: string | null;
  adapterPath: string;
  manifest: RegistryManifest;
}

/**
 * Fetches the adapter from the configured source, materializes it under
 * `<managed dir>/<slug>/adapter.{ts,js,mjs}`, and validates the file is a
 * well-formed RegistryAdapter by dynamic-importing it. Throws with a short,
 * actionable message on any failure and cleans up the partial managed dir.
 */
export async function installRegistry(
  input: RegistryInstallInput,
  authFetch: AuthenticatedFetch,
  opts: { noCache?: boolean } = {},
): Promise<RegistryInstallResult> {
  if (!isValidSlug(input.slug)) {
    throw new Error(
      `Invalid slug "${input.slug}". Allowed: lowercase letters, digits, and dashes; ` +
        `must start with a letter or digit.`,
    );
  }

  const targetDir = join(getManagedRegistriesDir(), input.slug);

  try {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    mkdirSync(targetDir, { recursive: true });

    let adapterPath: string;
    let resolvedRef: string | null = null;

    if (input.type === 'github' || input.type === 'gitlab') {
      const { adapterFile, resolvedSha } = await fetchAdapterFromRepo(
        input.type,
        input.source,
        authFetch,
        opts,
      );
      const ext = adapterFile.slice(adapterFile.lastIndexOf('.'));
      adapterPath = join(targetDir, `adapter${ext}`);
      copyFileSync(adapterFile, adapterPath);
      resolvedRef = resolvedSha;
    } else {
      const { content, ext } = await fetchAdapterFromUrl(input.source, authFetch);
      adapterPath = join(targetDir, `adapter${ext}`);
      writeFileSync(adapterPath, content, 'utf-8');
    }

    const adapter = await loadAdapterFile(adapterPath);
    return { resolvedRef, adapterPath, manifest: adapter.manifest };
  } catch (err) {
    try {
      rmSync(targetDir, { recursive: true, force: true });
    } catch {}
    throw err;
  }
}

/**
 * Returns the raw adapter source for preview purposes without persisting
 * anything to disk. Used by `GET /api/registries/preview` to populate the
 * "I trust this code" confirmation dialog in the UI.
 */
export async function fetchAdapterSource(
  input: Pick<RegistryInstallInput, 'type' | 'source'>,
  authFetch: AuthenticatedFetch,
  opts: { noCache?: boolean } = {},
): Promise<{ content: string; resolvedRef: string | null }> {
  if (input.type === 'github' || input.type === 'gitlab') {
    const { adapterFile, resolvedSha } = await fetchAdapterFromRepo(
      input.type,
      input.source,
      authFetch,
      opts,
    );
    return { content: readFileSync(adapterFile, 'utf-8'), resolvedRef: resolvedSha };
  }
  const { content } = await fetchAdapterFromUrl(input.source, authFetch);
  return { content, resolvedRef: null };
}

/**
 * Path of the materialized adapter file for a given slug, or null if no
 * adapter has been written yet. Iterates the known extensions in priority
 * order — first match wins.
 */
export function getInstalledAdapterPath(slug: string): string | null {
  const dir = join(getManagedRegistriesDir(), slug);
  for (const name of ADAPTER_BASENAMES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function removeInstalledAdapter(slug: string): void {
  const dir = join(getManagedRegistriesDir(), slug);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function fetchAdapterFromRepo(
  platform: 'github' | 'gitlab',
  source: string,
  authFetch: AuthenticatedFetch,
  opts: { noCache?: boolean },
): Promise<{ adapterFile: string; resolvedSha: string }> {
  let parsed;
  try {
    parsed = parseRepoString(source);
  } catch (err: any) {
    throw new Error(
      `Invalid ${platform} source "${source}". Expected "owner/repo@<name>" or ` +
        `"owner/repo::path/to/<name>".\n  ${err.message}`,
    );
  }

  const snapshot = await snapshotForRegistry(platform, parsed.ownerRepo, authFetch, {
    version: parsed.version,
    ref: parsed.sha,
    noCache: opts.noCache,
  });

  let candidateDir: string;
  if (parsed.mode === 'exact') {
    try {
      candidateDir = assertSafeRepoPath(snapshot.snapshotDir, parsed.target);
    } catch (err: any) {
      throw new Error(
        `${err.message}\n    Repository: ${parsed.ownerRepo}\n    Snapshot:   ${snapshot.resolvedSha.slice(0, 7)}`,
      );
    }
    if (!existsSync(candidateDir)) {
      throw new Error(
        `Directory "${parsed.target}" not found in ${parsed.ownerRepo} at ` +
          `${snapshot.resolvedSha.slice(0, 7)}.`,
      );
    }
  } else {
    const matches = findAdapterDirsByBasename(snapshot.snapshotDir, parsed.target);
    if (matches.length === 0) {
      throw new Error(
        `No directory named "${parsed.target}" containing an adapter.{ts,js,mjs} file ` +
          `was found in ${parsed.ownerRepo} at ${snapshot.resolvedSha.slice(0, 7)}.\n` +
          `    Tip: Use "${parsed.ownerRepo}::path/to/${parsed.target}" to reference an exact path.`,
      );
    }
    if (matches.length > 1) {
      const sample = matches
        .map((d) => d.slice(snapshot.snapshotDir.length + 1))
        .slice(0, 8)
        .join(', ');
      throw new Error(
        `Ambiguous reference: ${matches.length} directories named "${parsed.target}" with ` +
          `an adapter file exist in ${parsed.ownerRepo}.\n    Matches: ${sample}\n` +
          `    Tip: Use "::<exact-path>" to disambiguate.`,
      );
    }
    candidateDir = matches[0];
  }

  for (const adapterBasename of ADAPTER_BASENAMES) {
    const candidate = join(candidateDir, adapterBasename);
    if (existsSync(candidate)) {
      return { adapterFile: candidate, resolvedSha: snapshot.resolvedSha };
    }
  }

  const relDir = candidateDir.startsWith(snapshot.snapshotDir)
    ? candidateDir.slice(snapshot.snapshotDir.length + 1) || '.'
    : candidateDir;
  throw new Error(
    `No adapter.{ts,js,mjs} file found in "${relDir}" of ${parsed.ownerRepo} at ` +
      `${snapshot.resolvedSha.slice(0, 7)}.`,
  );
}

function findAdapterDirsByBasename(root: string, wanted: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name === wanted) {
        const hasAdapter = ADAPTER_BASENAMES.some((b) => existsSync(join(full, b)));
        if (hasAdapter) out.push(full);
      }
      walk(full);
    }
  }
  walk(root);
  return out;
}

async function fetchAdapterFromUrl(
  url: string,
  authFetch: AuthenticatedFetch,
): Promise<{ content: string; ext: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Invalid URL "${url}".`);
  }
  const isLocalhost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !isLocalhost) {
    throw new Error(
      `URL must use HTTPS (got ${u.protocol}//${u.hostname}). Insecure adapter sources are not allowed.`,
    );
  }

  const base = basename(u.pathname);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot) : '';
  if (!(ADAPTER_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(
      `URL must point to an adapter file with .ts, .js, or .mjs extension; got "${base || url}".`,
    );
  }

  let response: Response;
  try {
    response = await authFetch.fetch(url);
  } catch (err: any) {
    throw new Error(`Failed to fetch ${url}: ${err?.message ?? err}`);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const content = await response.text();
  if (!content.trim()) {
    throw new Error(`Adapter fetched from ${url} is empty.`);
  }
  return { content, ext };
}

async function snapshotForRegistry(
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  opts: { version?: string; ref?: string; noCache?: boolean },
): Promise<{ snapshotDir: string; resolvedSha: string }> {
  const hasAuth = authFetch.hasAuth(`https://${platform}.com/${repoPath}`);
  const platformName = getGitProvider(platform)?.displayName ?? platform;
  try {
    return await getOrCreateSnapshot({
      platform,
      repoPath,
      authFetch,
      version: opts.version,
      ref: opts.ref,
      noCache: opts.noCache,
    });
  } catch (err: any) {
    const message: string = err?.stderr || err?.message || '';
    if (message.includes('Authentication failed') || message.includes('could not read Username')) {
      throw new Error(
        `${platformName} authentication failed for ${repoPath} — token may be expired; ` +
          `run \`capa auth ${platform}.com\` to reconnect.`,
      );
    }
    if (
      message.includes('could not be found') ||
      message.includes('not found') ||
      message.includes("don't have permission")
    ) {
      const hint = hasAuth
        ? `Check the path, or ensure your ${platformName} token has access.`
        : `Check the path, or connect ${platformName} via \`capa auth ${platform}.com\` if the repo is private.`;
      throw new Error(`${platformName} repository not accessible: ${repoPath} — ${hint}`);
    }
    if (message.includes('unable to access') || message.includes('Could not resolve host')) {
      throw new Error(`Network error: cannot reach ${platform}.com — check your internet connection.`);
    }
    throw new Error(`Failed to fetch ${repoPath} from ${platformName}: ${message || 'Unknown error'}`);
  }
}

async function loadAdapterFile(filePath: string): Promise<RegistryAdapter> {
  const mtime = statSync(filePath).mtimeMs;
  const moduleUrl = `file://${filePath.replace(/\\/g, '/')}?t=${mtime}`;
  let module;
  try {
    module = await import(moduleUrl);
  } catch (err: any) {
    throw new Error(`Adapter at ${filePath} failed to import: ${err?.message ?? err}`);
  }
  const adapter: unknown = module.default ?? module;
  if (!isValidAdapter(adapter)) {
    throw new Error(
      `Adapter at ${filePath} does not export a valid RegistryAdapter ` +
        `(needs default export with { manifest, search, view }).`,
    );
  }
  return adapter;
}

function isValidAdapter(obj: unknown): obj is RegistryAdapter {
  if (!obj || typeof obj !== 'object') return false;
  const a = obj as Record<string, unknown>;
  if (!a.manifest || typeof a.manifest !== 'object') return false;
  const m = a.manifest as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    typeof m.name === 'string' &&
    m.name.length > 0 &&
    Array.isArray(m.capabilities) &&
    m.capabilities.length > 0 &&
    typeof a.search === 'function' &&
    typeof a.view === 'function'
  );
}
