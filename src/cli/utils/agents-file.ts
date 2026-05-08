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
import { getProvider } from '../../shared/providers';
import { buildSubAgentFile as buildSubAgentFileContent } from '../../shared/providers/handlers';

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
  for (const pid of providers) {
    const p = getProvider(pid);
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
  ownerRepo: string;
  filepath: string;
  version?: string;
  sha?: string;
}

function parseRepoString(repo: string): ParsedAgentRepo {
  const atIdx = repo.indexOf('@');
  if (atIdx === -1) {
    throw new Error(
      `Invalid agent repo format: "${repo}". Expected "owner/repo@filepath", ` +
      `optionally followed by ":version" or "#sha".`
    );
  }

  const ownerRepo = repo.slice(0, atIdx);
  const rest = repo.slice(atIdx + 1);

  const shaIdx = rest.lastIndexOf('#');
  if (shaIdx !== -1) {
    return { ownerRepo, filepath: rest.slice(0, shaIdx), sha: rest.slice(shaIdx + 1) };
  }

  const colonIdx = rest.lastIndexOf(':');
  if (colonIdx !== -1) {
    return { ownerRepo, filepath: rest.slice(0, colonIdx), version: rest.slice(colonIdx + 1) };
  }

  return { ownerRepo, filepath: rest };
}

function buildRawUrl(platform: 'github' | 'gitlab', parsed: ParsedAgentRepo): string {
  const ref = parsed.sha ?? parsed.version ?? 'HEAD';
  if (platform === 'github') {
    return `https://raw.githubusercontent.com/${parsed.ownerRepo}/${ref}/${parsed.filepath}`;
  }
  return `https://gitlab.com/${parsed.ownerRepo}/-/raw/${ref}/${parsed.filepath}`;
}

function deriveIdFromFilepath(filepath: string): string {
  return filepath.replace(/[^a-zA-Z0-9_-]/g, '_');
}

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
  capabilitiesFilePath?: string
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
      const parsed = parseRepoString(config.base.def.repo);
      const url = buildRawUrl(baseType, parsed);
      console.log(`  Fetching base agents file from ${url}`);
      baseContent = await fetchRemoteContent(url);
    } else if (config.base.ref) {
      console.log(`  Fetching base agents file from ${config.base.ref}`);
      baseContent = await fetchRemoteContent(config.base.ref);
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

  const hasBase = !!config.base;
  for (const filename of targetFiles) {
    applyConfigToFile(projectPath, filename, hasBase, snippetBodies);
    console.log(`  ✓ ${filename} updated`);
  }
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
