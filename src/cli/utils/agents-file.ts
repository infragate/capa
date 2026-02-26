import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { AgentFileConfig, SecurityOptions } from '../../types/capabilities';
import {
  loadBlockedPhrases,
  checkBlockedPhrases,
  sanitizeContent,
  getAllowedCharacters,
  isBlockedPhrasesEnabled,
  isCharacterSanitizationEnabled,
  reportBlockedPhraseAndExit,
} from '../../shared/skill-security';

export const AGENTS_FILENAME = 'AGENTS.md';
export const CLAUDE_FILENAME = 'CLAUDE.md';

const MARKER_START = (id: string) => `<!-- capa:start:${id} -->`;
const MARKER_END = (id: string) => `<!-- capa:end:${id} -->`;

// Matches a full capa-managed block for a given id (greedy within the block).
const blockPattern = (id: string) =>
  new RegExp(
    `${escapeRegex(MARKER_START(id))}[\\s\\S]*?${escapeRegex(MARKER_END(id))}`,
    'g'
  );

// Matches every capa-managed block in a file (used for listing / bulk removal).
const ANY_BLOCK_PATTERN =
  /<!-- capa:start:([^>]+?) -->[\s\S]*?<!-- capa:end:\1 -->/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the full text of a capa-owned block including its markers. */
function buildBlock(id: string, body: string): string {
  const trimmed = body.trimEnd();
  return `${MARKER_START(id)}\n${trimmed}\n${MARKER_END(id)}`;
}

/**
 * Determine which agent instruction filenames to manage based on the active providers.
 * - AGENTS.md is always managed (universal format supported by Cursor, Codex, Jules, etc.)
 * - CLAUDE.md is additionally managed when any Claude provider (e.g. `claude-code`) is present,
 *   since Claude Code reads `./CLAUDE.md` at project root.
 */
export function getTargetFilenames(providers: string[]): string[] {
  const filenames: string[] = [AGENTS_FILENAME];
  const hasClaudeProvider = providers.some((p) => p.startsWith('claude'));
  if (hasClaudeProvider) {
    filenames.push(CLAUDE_FILENAME);
  }
  return filenames;
}

/** Read a file; returns empty string if it doesn't exist. */
function readMdFile(projectPath: string, filename: string): string {
  const filePath = join(projectPath, filename);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

/** Write content to a file. */
function writeMdFile(projectPath: string, filename: string, content: string): void {
  writeFileSync(join(projectPath, filename), content, 'utf8');
}

/** Delete a file if it exists. */
function deleteMdFile(projectPath: string, filename: string): void {
  const filePath = join(projectPath, filename);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/**
 * Insert or replace a capa-owned snippet block in the file content.
 * If the block already exists it is updated in place; otherwise it is appended.
 */
export function upsertSnippet(content: string, id: string, body: string): string {
  const block = buildBlock(id, body);
  if (blockPattern(id).test(content)) {
    return content.replace(blockPattern(id), block);
  }
  // Append: ensure a single blank line before the new block.
  const base = content.trimEnd();
  return base.length > 0 ? `${base}\n\n${block}\n` : `${block}\n`;
}

/**
 * Remove the capa-owned block for a given id from the file content.
 * Returns the content unchanged if the block is not present.
 */
export function removeSnippet(content: string, id: string): string {
  return content.replace(blockPattern(id), '').replace(/\n{3,}/g, '\n\n');
}

/**
 * Remove all capa-owned blocks from the file content.
 * Collapses any resulting run of blank lines to at most one blank line.
 */
export function removeAllCapaSnippets(content: string): string {
  return content.replace(ANY_BLOCK_PATTERN, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Return the list of snippet ids currently present in the file content.
 */
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
 * Fetch text content from a remote URL.
 * Throws if the request fails or returns a non-OK status.
 */
export async function fetchRemoteContent(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

// ---------------------------------------------------------------------------
// GitHub / GitLab repo-string resolution
// ---------------------------------------------------------------------------

interface ParsedAgentRepo {
  ownerRepo: string;  // e.g. "vercel-labs/agent-skills"
  filepath: string;   // e.g. "AGENTS.md" or "docs/tips.md"
  version?: string;   // e.g. "v1.2.0"
  sha?: string;       // e.g. "abc123def"
}

/**
 * Parse a repo string of the form "owner/repo@filepath" with an optional
 * ":version" or "#sha" suffix.
 *
 * Examples:
 *   "vercel-labs/agent-skills@AGENTS.md"
 *   "vercel-labs/agent-skills@docs/tips.md:v1.2.0"
 *   "vercel-labs/agent-skills@AGENTS.md#abc123def"
 */
function parseRepoString(repo: string): ParsedAgentRepo {
  // Split on the first '@' to separate repo from filepath (+ optional specifier).
  const atIdx = repo.indexOf('@');
  if (atIdx === -1) {
    throw new Error(
      `Invalid agent repo format: "${repo}". Expected "owner/repo@filepath", ` +
      `optionally followed by ":version" or "#sha".`
    );
  }

  const ownerRepo = repo.slice(0, atIdx);
  const rest = repo.slice(atIdx + 1); // "filepath" or "filepath:v1" or "filepath#abc"

  // SHA suffix: #<hex>
  const shaIdx = rest.lastIndexOf('#');
  if (shaIdx !== -1) {
    return { ownerRepo, filepath: rest.slice(0, shaIdx), sha: rest.slice(shaIdx + 1) };
  }

  // Version/tag suffix: :version (last colon wins to avoid clashing with drive letters)
  const colonIdx = rest.lastIndexOf(':');
  if (colonIdx !== -1) {
    return { ownerRepo, filepath: rest.slice(0, colonIdx), version: rest.slice(colonIdx + 1) };
  }

  return { ownerRepo, filepath: rest };
}

/**
 * Build a raw content URL for a file inside a GitHub or GitLab repository.
 * Uses "HEAD" as the default ref so it always tracks the default branch.
 */
function buildRawUrl(platform: 'github' | 'gitlab', parsed: ParsedAgentRepo): string {
  const ref = parsed.sha ?? parsed.version ?? 'HEAD';
  if (platform === 'github') {
    return `https://raw.githubusercontent.com/${parsed.ownerRepo}/${ref}/${parsed.filepath}`;
  }
  return `https://gitlab.com/${parsed.ownerRepo}/-/raw/${ref}/${parsed.filepath}`;
}

/**
 * Derive a stable snippet id from a repo filepath when the user does not
 * provide one explicitly.  Non-alphanumeric characters are replaced with "_".
 * Example: "docs/AGENTS.md" → "docs_AGENTS_md"
 */
function deriveIdFromFilepath(filepath: string): string {
  return filepath.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Resolve a github/gitlab snippet to its { id, body } pair.
 * Parses the `def.repo` string, builds the raw URL, and fetches the content.
 */
async function resolveRepoSnippet(
  platform: 'github' | 'gitlab',
  snippet: { id?: string; def?: { repo: string } }
): Promise<{ id: string; body: string }> {
  if (!snippet.def?.repo) {
    throw new Error(
      `Agent snippet of type '${platform}' is missing a "def.repo" field.`
    );
  }
  const parsed = parseRepoString(snippet.def.repo);
  const id = snippet.id ?? deriveIdFromFilepath(parsed.filepath);
  const url = buildRawUrl(platform, parsed);
  console.log(`  Fetching ${platform} snippet "${id}" from ${url}`);
  const body = await fetchRemoteContent(url);
  return { id, body };
}

/**
 * Apply the `agents` configuration to a single target file.
 *
 * `snippetBodies` contains the already-resolved, security-checked content keyed by
 * the effective snippet id (including ids derived from github/gitlab filepaths).
 * The reserved key `__base__` holds the base file content when `base.ref` is set.
 *
 * When a base is configured the file is rebuilt from scratch:
 *   base content (written as-is, no markers) + all snippets appended with markers.
 *
 * When no base is configured the existing file is edited in place:
 *   1. Upsert each snippet (add if missing, replace if changed).
 *   2. Prune any capa-owned blocks whose id is no longer present in `snippetBodies`.
 */
function applyConfigToFile(
  projectPath: string,
  filename: string,
  hasBase: boolean,
  snippetBodies: Map<string, string>
): void {
  let content: string;

  // Snippet entries (everything except the reserved __base__ key).
  const snippetEntries = [...snippetBodies.entries()].filter(([id]) => id !== '__base__');

  if (hasBase) {
    // Rebuild from scratch: base content followed by all snippets.
    // Existing user edits outside markers are intentionally replaced — the base is
    // the authoritative starting point and re-install always refreshes it.
    content = snippetBodies.get('__base__')!.trimEnd();
    for (const [id, body] of snippetEntries) {
      content = upsertSnippet(content, id, body);
    }
  } else {
    // No base: edit the existing file in place, preserving user content.
    content = readMdFile(projectPath, filename);

    const currentIds = new Set(snippetEntries.map(([id]) => id));
    for (const [id, body] of snippetEntries) {
      content = upsertSnippet(content, id, body);
    }

    // Prune capa blocks whose id is no longer in the current config.
    for (const id of listCapaSnippetIds(content)) {
      if (!currentIds.has(id)) {
        console.log(`  Removing stale agent snippet "${id}" from ${filename}`);
        content = removeSnippet(content, id);
      }
    }
  }

  writeMdFile(projectPath, filename, content);
}

/**
 * Apply the full `agents` configuration to all target files.
 *
 * Target files are determined by the active providers:
 *   - AGENTS.md: always written (universal format)
 *   - CLAUDE.md: written when any `claude*` provider is present (e.g. `claude-code`)
 *
 * Remote content is fetched once and reused for all target files.
 * The same security checks (blocked phrases, character sanitization) that apply to skills
 * are applied to all agent snippet content before it is written.
 *
 * @param security - Security options from `capabilities.options.security`
 * @param capabilitiesFilePath - Full path to the capabilities file (used to resolve a
 *   file-based blockedPhrases list relative to the capabilities directory)
 */
export async function installAgentsFile(
  projectPath: string,
  config: AgentFileConfig,
  providers: string[],
  security?: SecurityOptions,
  capabilitiesFilePath?: string
): Promise<void> {
  const targetFiles = getTargetFilenames(providers);

  // Resolve security settings once.
  const blockedEnabled = isBlockedPhrasesEnabled(security);
  const sanitizeEnabled = isCharacterSanitizationEnabled(security);
  const blockedPhrases = blockedEnabled && capabilitiesFilePath
    ? loadBlockedPhrases(security, capabilitiesFilePath)
    : [];
  const allowedCharacters = sanitizeEnabled ? getAllowedCharacters(security) : null;

  /** Run blocked-phrase check and optional sanitization on a piece of content. */
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

  // Pre-fetch and secure all content once so we don't hit the network per file.
  const snippetBodies = new Map<string, string>();

  if (config.base) {
    let baseContent: string;
    const baseType = config.base.type ?? (config.base.ref ? 'remote' : undefined);

    if (baseType === 'github' || baseType === 'gitlab') {
      if (!config.base.def?.repo) {
        throw new Error(
          `agents.base with type '${baseType}' requires a "def.repo" field ` +
          `(e.g. "owner/repo@AGENTS.md").`
        );
      }
      const parsed = parseRepoString(config.base.def.repo);
      const url = buildRawUrl(baseType, parsed);
      console.log(`  Fetching base agents file from ${url}`);
      baseContent = await fetchRemoteContent(url);
    } else if (config.base.ref) {
      console.log(`  Fetching base agents file from ${config.base.ref}`);
      baseContent = await fetchRemoteContent(config.base.ref);
    } else {
      throw new Error(
        `agents.base requires either a "ref" URL or a "type: github/gitlab" ` +
        `with a "def.repo" field.`
      );
    }

    snippetBodies.set('__base__', applySecurityChecks(baseContent, 'agents:base'));
  }

  for (const snippet of config.additional ?? []) {
    let resolvedId: string;
    let body: string;

    if (snippet.type === 'inline') {
      if (!snippet.id) {
        throw new Error(`Agent inline snippet is missing an "id" field.`);
      }
      if (!snippet.content) {
        throw new Error(`Agent snippet "${snippet.id}" is type 'inline' but has no content.`);
      }
      resolvedId = snippet.id;
      body = snippet.content;
    } else if (snippet.type === 'remote') {
      if (!snippet.id) {
        throw new Error(`Agent remote snippet is missing an "id" field.`);
      }
      if (!snippet.url) {
        throw new Error(`Agent snippet "${snippet.id}" is type 'remote' but has no url.`);
      }
      resolvedId = snippet.id;
      console.log(`  Fetching remote snippet "${resolvedId}" from ${snippet.url}`);
      body = await fetchRemoteContent(snippet.url);
    } else if (snippet.type === 'github' || snippet.type === 'gitlab') {
      const resolved = await resolveRepoSnippet(snippet.type, snippet);
      resolvedId = resolved.id;
      body = resolved.body;
    } else {
      throw new Error(`Unknown agent snippet type: ${(snippet as any).type}`);
    }

    snippetBodies.set(resolvedId, applySecurityChecks(body, `agents:${resolvedId}`));
  }

  // Apply to each target file.
  const hasBase = !!config.base;
  for (const filename of targetFiles) {
    applyConfigToFile(projectPath, filename, hasBase, snippetBodies);
    console.log(`  ✓ ${filename} updated`);
  }
}

/**
 * Remove all capa-managed blocks from every target agent instructions file.
 * Deletes a file entirely if it becomes empty after cleaning.
 * Target files are determined by the active providers (same logic as install).
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
