import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import type { AgentFileConfig, SecurityOptions, SubAgent, Capabilities } from '../../types/capabilities';
import {
  loadBlockedPhrases,
  checkBlockedPhrases,
  sanitizeContent,
  getAllowedCharacters,
  isBlockedPhrasesEnabled,
  isCharacterSanitizationEnabled,
  reportBlockedPhraseAndExit,
} from '../../shared/skill-security';
import { getProvider, getAllProviders } from '../../shared/providers';
import { buildSubAgentFile as buildSubAgentFileContent } from '../../shared/providers/handlers';
import type { AuthenticatedFetch } from '../../shared/authenticated-fetch';
import { fetchRepoFile, fetchTextFile, type RepoSnapshotResolver } from '../../shared/repo-file';

export const AGENTS_FILENAME = 'AGENTS.md';
export const CLAUDE_FILENAME = 'CLAUDE.md';

const MARKER_START = (id: string) => `<!-- capa:start:${id} -->`;
const MARKER_END = (id: string) => `<!-- capa:end:${id} -->`;

const blockPattern = (id: string) =>
  new RegExp(
    `${escapeRegex(MARKER_START(id))}[\\s\\S]*?${escapeRegex(MARKER_END(id))}`,
    'g'
  );

const ANY_BLOCK_PATTERN =
  /<!-- capa:start:([^>]+?) -->[\s\S]*?<!-- capa:end:\1 -->/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBlock(id: string, body: string): string {
  const trimmed = body.trimEnd();
  return `${MARKER_START(id)}\n${trimmed}\n${MARKER_END(id)}`;
}

/**
 * Determine which agent instruction filenames to manage based on the active providers.
 * Uses the provider registry to collect unique instruction filenames.
 * AGENTS.md is always included as the universal baseline.
 */
export function getTargetFilenames(providers: string[]): string[] {
  const filenames = new Set<string>([AGENTS_FILENAME]);
  const list = providers.length > 0 ? providers.map(getProvider).filter(Boolean) : getAllProviders();
  for (const p of list) {
    if (p?.instructions) {
      filenames.add(p.instructions.filename);
    }
  }
  return [...filenames];
}

function readMdFile(projectPath: string, filename: string): string {
  const filePath = join(projectPath, filename);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function writeMdFile(projectPath: string, filename: string, content: string): void {
  const dir = dirname(join(projectPath, filename));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(projectPath, filename), content, 'utf8');
}

function deleteMdFile(projectPath: string, filename: string): void {
  const filePath = join(projectPath, filename);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export function upsertSnippet(content: string, id: string, body: string): string {
  const block = buildBlock(id, body);
  if (blockPattern(id).test(content)) {
    return content.replace(blockPattern(id), block);
  }
  const base = content.trimEnd();
  return base.length > 0 ? `${base}\n\n${block}\n` : `${block}\n`;
}

export function removeSnippet(content: string, id: string): string {
  return content.replace(blockPattern(id), '').replace(/\n{3,}/g, '\n\n');
}

export function removeAllCapaSnippets(content: string): string {
  return content.replace(ANY_BLOCK_PATTERN, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function listCapaSnippetIds(content: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  const re = /<!-- capa:start:([^>]+?) -->/g;
  while ((match = re.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

/**
 * Fetch a text file from a raw URL.
 *
 * Backwards-compatible wrapper around `fetchTextFile` from `shared/repo-file`.
 * The new helper additionally rejects HTML responses (which usually indicate
 * a private-repo login redirect that would otherwise be silently written
 * verbatim into AGENTS.md / CLAUDE.md).
 */
export async function fetchRemoteContent(
  url: string,
  options: { authFetch?: AuthenticatedFetch; sourceLabel?: string } = {}
): Promise<string> {
  return fetchTextFile(url, options);
}

// ---------------------------------------------------------------------------
// GitHub / GitLab repo-string resolution (shared utility)
// ---------------------------------------------------------------------------

import { parseRepoString } from '../../shared/repo-string';

function deriveIdFromFilepath(filepath: string): string {
  return filepath.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function resolveRepoSnippet(
  platform: 'github' | 'gitlab',
  snippet: { id?: string; def?: { repo: string } },
  ctx: RepoFetchContext
): Promise<{ id: string; body: string }> {
  if (!snippet.def?.repo) {
    throw new Error(
      `Agent snippet of type '${platform}' is missing a "def.repo" field.`
    );
  }
  const parsed = parseRepoString(snippet.def.repo);
  const id = snippet.id ?? deriveIdFromFilepath(parsed.filepath);
  if (!ctx.authFetch || !ctx.getRepoSnapshot) {
    throw new Error(
      `Cannot resolve ${platform} snippet "${id}" — repo snapshot resolver is not configured. ` +
      `This is a bug; please report it.`
    );
  }
  console.log(`  Fetching ${platform} snippet "${id}" from ${parsed.ownerRepo}@${parsed.filepath}`);
  const result = await fetchRepoFile(
    platform,
    snippet.def.repo,
    ctx.getRepoSnapshot,
    ctx.authFetch,
    { noCache: ctx.noCache }
  );
  return { id, body: result.content };
}

/**
 * Context passed through `installAgentsFile` so it can clone private repos
 * via the existing snapshot/cache machinery instead of relying on raw HTTP
 * fetches that fail (silently!) on auth-gated GitLab / GitHub URLs.
 */
export interface RepoFetchContext {
  authFetch?: AuthenticatedFetch;
  getRepoSnapshot?: RepoSnapshotResolver;
  noCache?: boolean;
}

function applyConfigToFile(
  projectPath: string,
  filename: string,
  hasBase: boolean,
  snippetBodies: Map<string, string>
): void {
  let content: string;

  const snippetEntries = [...snippetBodies.entries()].filter(([id]) => id !== '__base__');

  if (hasBase) {
    content = snippetBodies.get('__base__')!.trimEnd();
    for (const [id, body] of snippetEntries) {
      content = upsertSnippet(content, id, body);
    }
  } else {
    content = readMdFile(projectPath, filename);

    const currentIds = new Set(snippetEntries.map(([id]) => id));
    for (const [id, body] of snippetEntries) {
      content = upsertSnippet(content, id, body);
    }

    for (const id of listCapaSnippetIds(content)) {
      if (!currentIds.has(id)) {
        console.log(`  Removing stale agent snippet "${id}" from ${filename}`);
        content = removeSnippet(content, id);
      }
    }
  }

  writeMdFile(projectPath, filename, content);
}

export async function installAgentsFile(
  projectPath: string,
  config: AgentFileConfig,
  providers: string[],
  security?: SecurityOptions,
  capabilitiesFilePath?: string,
  ctx: RepoFetchContext = {}
): Promise<void> {
  const targetFiles = getTargetFilenames(providers);

  const blockedEnabled = isBlockedPhrasesEnabled(security);
  const sanitizeEnabled = isCharacterSanitizationEnabled(security);
  const blockedPhrases = blockedEnabled && capabilitiesFilePath
    ? loadBlockedPhrases(security, capabilitiesFilePath)
    : [];
  const allowedCharacters = sanitizeEnabled ? getAllowedCharacters(security) : null;

  function applySecurityChecks(content: string, sourceLabel: string): string {
    if (blockedEnabled && blockedPhrases.length > 0) {
      const check = checkBlockedPhrases(content, blockedPhrases);
      if (check.blocked) {
        reportBlockedPhraseAndExit(sourceLabel, '(agents)', check.phrase!);
      }
    }
    if (sanitizeEnabled && allowedCharacters !== null) {
      content = sanitizeContent(content, allowedCharacters);
    }
    return content;
  }

  const snippetBodies = new Map<string, string>();

  if (config.base) {
    let baseContent: string;
    const baseType = config.base.type ?? (config.base.ref ? 'remote' : undefined);

    if (baseType === 'local') {
      if (!config.base.path) {
        throw new Error(
          `agents.base with type 'local' requires a "path" field (e.g. "path: ./docs/AGENTS-base.md").`
        );
      }
      if (!capabilitiesFilePath) {
        throw new Error(
          `agents.base type 'local' requires the capabilities file path to resolve relative paths.`
        );
      }
      const capabilitiesDir = dirname(capabilitiesFilePath);
      const resolvedPath = resolve(capabilitiesDir, config.base.path);
      if (!existsSync(resolvedPath)) {
        throw new Error(
          `agents.base local file not found: ${resolvedPath} (resolved from path "${config.base.path}")`
        );
      }
      console.log(`  Using base agents file from ${resolvedPath}`);
      baseContent = readFileSync(resolvedPath, 'utf8');
    } else if (baseType === 'github' || baseType === 'gitlab') {
      if (!config.base.def?.repo) {
        throw new Error(
          `agents.base with type '${baseType}' requires a "def.repo" field ` +
          `(e.g. "owner/repo@AGENTS.md").`
        );
      }
      if (!ctx.authFetch || !ctx.getRepoSnapshot) {
        throw new Error(
          `Cannot resolve ${baseType} agents.base — repo snapshot resolver is not configured. ` +
          `This is a bug; please report it.`
        );
      }
      console.log(`  Fetching base agents file from ${baseType}:${config.base.def.repo}`);
      const result = await fetchRepoFile(
        baseType,
        config.base.def.repo,
        ctx.getRepoSnapshot,
        ctx.authFetch,
        { noCache: ctx.noCache }
      );
      baseContent = result.content;
    } else if (config.base.ref) {
      // Auto-detect github.com / gitlab.com raw URLs and route them through the
      // snapshot path so private repos work without manual reconfiguration.
      const repoCoords = detectRepoCoordsFromRawUrl(config.base.ref);
      if (repoCoords && ctx.authFetch && ctx.getRepoSnapshot) {
        console.log(
          `  Fetching base agents file from ${repoCoords.platform}:${repoCoords.repoString} ` +
          `(detected from raw URL)`
        );
        const result = await fetchRepoFile(
          repoCoords.platform,
          repoCoords.repoString,
          ctx.getRepoSnapshot,
          ctx.authFetch,
          { noCache: ctx.noCache }
        );
        baseContent = result.content;
      } else {
        console.log(`  Fetching base agents file from ${config.base.ref}`);
        baseContent = await fetchRemoteContent(config.base.ref, {
          authFetch: ctx.authFetch,
          sourceLabel: 'agents.base',
        });
      }
    } else {
      throw new Error(
        `agents.base requires a "ref" URL, "type: local" with "path", or "type: github/gitlab" ` +
        `with a "def.repo" field.`
      );
    }

    snippetBodies.set('__base__', applySecurityChecks(baseContent, 'agents:base'));
  }

  for (const snippet of config.additional ?? []) {
    let resolvedId: string;
    let body: string;

    if (snippet.type === 'inline') {
      if (!snippet.id) throw new Error(`Agent inline snippet is missing an "id" field.`);
      if (!snippet.content) throw new Error(`Agent snippet "${snippet.id}" is type 'inline' but has no content.`);
      resolvedId = snippet.id;
      body = snippet.content;
    } else if (snippet.type === 'remote') {
      if (!snippet.id) throw new Error(`Agent remote snippet is missing an "id" field.`);
      if (!snippet.url) throw new Error(`Agent snippet "${snippet.id}" is type 'remote' but has no url.`);
      resolvedId = snippet.id;

      const repoCoords = detectRepoCoordsFromRawUrl(snippet.url);
      if (repoCoords && ctx.authFetch && ctx.getRepoSnapshot) {
        console.log(
          `  Fetching remote snippet "${resolvedId}" from ${repoCoords.platform}:${repoCoords.repoString} ` +
          `(detected from raw URL)`
        );
        const result = await fetchRepoFile(
          repoCoords.platform,
          repoCoords.repoString,
          ctx.getRepoSnapshot,
          ctx.authFetch,
          { noCache: ctx.noCache }
        );
        body = result.content;
      } else {
        console.log(`  Fetching remote snippet "${resolvedId}" from ${snippet.url}`);
        body = await fetchRemoteContent(snippet.url, {
          authFetch: ctx.authFetch,
          sourceLabel: `agents snippet "${resolvedId}"`,
        });
      }
    } else if (snippet.type === 'github' || snippet.type === 'gitlab') {
      const resolved = await resolveRepoSnippet(snippet.type, snippet, ctx);
      resolvedId = resolved.id;
      body = resolved.body;
    } else {
      throw new Error(`Unknown agent snippet type: ${(snippet as any).type}`);
    }

    snippetBodies.set(resolvedId, applySecurityChecks(body, `agents:${resolvedId}`));
  }

  const hasBase = !!config.base;
  for (const filename of targetFiles) {
    applyConfigToFile(projectPath, filename, hasBase, snippetBodies);
    console.log(`  ✓ ${filename} updated`);
  }
}

/**
 * Detect a github.com / gitlab.com raw-content URL and translate it back into
 * a `(platform, owner/repo@filepath[:ref])` triple suitable for
 * `fetchRepoFile`. Returns `null` for URLs that don't match a recognized
 * raw-content shape (those callers should fall back to plain HTTP fetch).
 *
 * Accepted shapes (GitHub):
 *   https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
 *   https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/<branch>/<path>
 *   https://raw.githubusercontent.com/<owner>/<repo>/refs/tags/<tag>/<path>
 *   https://github.com/<owner>/<repo>/raw/<ref>/<path>
 *   https://github.com/<owner>/<repo>/raw/refs/heads/<branch>/<path>
 *
 * GitHub silently accepts both the bare `<ref>` and the fully-qualified
 * `refs/heads/<branch>` / `refs/tags/<tag>` forms in raw URLs, and the
 * GitHub UI's "Raw" button now generates the fully-qualified form by
 * default. Both must round-trip to the same parsed reference.
 *
 * Accepted shape (GitLab):
 *   https://gitlab.com/<group/.../subgroup>/<repo>/-/raw/<ref>/<path>
 */
export function detectRepoCoordsFromRawUrl(
  rawUrl: string
): { platform: 'github' | 'gitlab'; repoString: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (host === 'raw.githubusercontent.com') {
    if (segments.length < 4) return null;
    const [owner, repo, ...rest] = segments;
    const split = splitGithubRefAndPath(rest);
    if (!split) return null;
    return {
      platform: 'github',
      repoString: `${owner}/${repo}::${split.path}${refSuffix(split.ref)}`,
    };
  }

  if (host === 'github.com') {
    const rawIdx = segments.indexOf('raw');
    if (rawIdx === -1 || rawIdx < 2 || segments.length < rawIdx + 3) return null;
    const owner = segments[0];
    const repo = segments[1];
    const split = splitGithubRefAndPath(segments.slice(rawIdx + 1));
    if (!owner || !repo || !split) return null;
    return {
      platform: 'github',
      repoString: `${owner}/${repo}::${split.path}${refSuffix(split.ref)}`,
    };
  }

  if (host === 'gitlab.com') {
    const sepIdx = segments.indexOf('-');
    if (sepIdx === -1 || sepIdx < 2) return null;
    if (segments[sepIdx + 1] !== 'raw') return null;
    if (segments.length < sepIdx + 4) return null;
    const ownerRepo = segments.slice(0, sepIdx).join('/');
    const ref = segments[sepIdx + 2];
    const filepath = segments.slice(sepIdx + 3).join('/');
    if (!ownerRepo || !ref || !filepath) return null;
    return {
      platform: 'gitlab',
      repoString: `${ownerRepo}::${filepath}${refSuffix(ref)}`,
    };
  }

  return null;
}

/**
 * Split the post-`<owner>/<repo>` (or post-`/raw`) tail of a GitHub URL into
 * its `(ref, path)` components. Handles both the bare `<branch>/<path>` form
 * and the fully-qualified `refs/heads/<branch>/<path>` and
 * `refs/tags/<tag>/<path>` forms that GitHub's "Raw" button produces.
 *
 * Returns `null` when the tail can't be split into a non-empty ref + path.
 */
function splitGithubRefAndPath(
  tail: string[]
): { ref: string; path: string } | null {
  if (
    tail.length >= 4 &&
    tail[0] === 'refs' &&
    (tail[1] === 'heads' || tail[1] === 'tags')
  ) {
    const ref = tail[2];
    const path = tail.slice(3).join('/');
    if (!ref || !path) return null;
    return { ref, path };
  }
  if (tail.length < 2) return null;
  const ref = tail[0];
  const path = tail.slice(1).join('/');
  if (!ref || !path) return null;
  return { ref, path };
}

function refSuffix(ref: string): string {
  if (!ref || ref === 'HEAD' || ref === 'main' || ref === 'master') return '';
  // SHAs go after `#`, named refs after `:`. Use a heuristic: 7-40 hex chars
  // ⇒ commit SHA; everything else ⇒ tag/branch.
  if (/^[0-9a-f]{7,40}$/i.test(ref)) {
    return `#${ref}`;
  }
  return `:${ref}`;
}

// ---------------------------------------------------------------------------
// Sub-agent instructions — registry-driven
// ---------------------------------------------------------------------------

/**
 * Write a sub-agent definition file using the provider's subagents integration.
 */
function writeSubAgentFile(
  projectPath: string,
  providerId: string,
  subAgent: SubAgent,
  capabilities: Capabilities
): void {
  const provider = getProvider(providerId);
  if (!provider?.subagents) return;

  const { subagents: sa } = provider;
  const agentsDir = join(projectPath, sa.dir);
  mkdirSync(agentsDir, { recursive: true });

  const filePath = join(agentsDir, `${subAgent.id}${sa.extension}`);
  const content = buildSubAgentFileContent(provider, subAgent, capabilities);
  writeFileSync(filePath, content, 'utf8');

  console.log(`  ✓ ${sa.dir}/${subAgent.id}${sa.extension} written`);
}

/**
 * Remove a sub-agent definition file for a provider.
 */
function removeSubAgentFile(projectPath: string, providerId: string, agentId: string): void {
  const provider = getProvider(providerId);
  if (!provider?.subagents) return;

  const { subagents: sa } = provider;
  const filePath = join(projectPath, sa.dir, `${agentId}${sa.extension}`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    console.log(`  ✓ Removed ${sa.dir}/${agentId}${sa.extension}`);
  }

  // Legacy cleanup for Cursor: remove old .cursor/rules/{id}.mdc files
  if (providerId === 'cursor') {
    const legacyPath = join(projectPath, '.cursor', 'rules', `${agentId}.mdc`);
    if (existsSync(legacyPath)) {
      unlinkSync(legacyPath);
    }
  }
}

/**
 * Install sub-agent definition files for each active provider.
 *
 * For providers with a `subagents` integration, writes the agent file using
 * the provider-specific format (markdown frontmatter or TOML).
 *
 * For providers with an `instructions` integration, also upserts a context
 * block into the instructions file (e.g. CLAUDE.md for claude-code).
 */
export function installSubAgentInstructions(
  projectPath: string,
  subAgent: SubAgent,
  capabilities: Capabilities,
  providers: string[]
): void {
  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider) continue;

    const mcpServerKey = `capa-${subAgent.id}`;

    // Write the sub-agent definition file
    if (provider.subagents) {
      writeSubAgentFile(projectPath, pid, subAgent, capabilities);
    }

    // For providers with a distinct instructions file (e.g. CLAUDE.md),
    // add a context block so the main agent knows about the sub-agent.
    if (provider.instructions && provider.instructions.filename !== AGENTS_FILENAME) {
      const snippetId = `sub-agent:${subAgent.id}`;
      const bodyLines = [
        `## Agent: ${subAgent.id}`,
        ...(subAgent.description ? ['', subAgent.description] : []),
        '',
        `**MCP server key:** \`${mcpServerKey}\``,
        `**Skills:** ${subAgent.skills.length > 0 ? subAgent.skills.join(', ') : '(none)'}`,
      ];
      if (subAgent.instructions) {
        bodyLines.push('', subAgent.instructions.trimEnd());
      }

      const filename = provider.instructions.filename;
      let content = readMdFile(projectPath, filename);
      content = upsertSnippet(content, snippetId, bodyLines.join('\n'));
      writeMdFile(projectPath, filename, content);
      console.log(`  ✓ ${filename} updated with sub-agent "${subAgent.id}" instructions`);
    }
  }
}

/**
 * Remove sub-agent definition files for all active providers.
 */
export function removeSubAgentInstructions(
  projectPath: string,
  agentId: string,
  providers: string[]
): void {
  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider) continue;

    if (provider.subagents) {
      removeSubAgentFile(projectPath, pid, agentId);
    }

    if (provider.instructions && provider.instructions.filename !== AGENTS_FILENAME) {
      const snippetId = `sub-agent:${agentId}`;
      const filename = provider.instructions.filename;
      const content = readMdFile(projectPath, filename);
      if (content) {
        writeMdFile(projectPath, filename, removeSnippet(content, snippetId));
        console.log(`  ✓ Removed sub-agent "${agentId}" instructions from ${filename}`);
      }
    }
  }
}

/**
 * Remove all capa-managed blocks from every target agent instructions file.
 * Deletes a file entirely if it becomes empty after cleaning.
 */
export function cleanAgentsFile(projectPath: string, providers: string[]): void {
  const targetFiles = getTargetFilenames(providers);

  for (const filename of targetFiles) {
    const content = readMdFile(projectPath, filename);
    if (content === '') continue;

    const cleaned = removeAllCapaSnippets(content);

    if (cleaned.trim() === '') {
      deleteMdFile(projectPath, filename);
      console.log(`  ✓ Removed ${filename} (was entirely capa-managed)`);
    } else {
      writeMdFile(projectPath, filename, cleaned + '\n');
      console.log(`  ✓ Removed capa snippets from ${filename}`);
    }
  }
}
