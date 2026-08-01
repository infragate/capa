import { existsSync, readFileSync } from 'fs';
import { dirname } from 'path';
import type { AgentFileConfig, SecurityOptions } from '../../../types/capabilities';
import {
  loadBlockedPhrases,
  checkBlockedPhrases,
  sanitizeContent,
  getAllowedCharacters,
  isBlockedPhrasesEnabled,
  isCharacterSanitizationEnabled,
  reportBlockedPhraseAndExit,
} from '../../../shared/skill-security';
import { getProvider, getAllProviders } from '../../../shared/providers';
import { fetchRepoFile, assertSafeRepoPath } from '../../../shared/repo-file';
import { taskLog } from '../../ui';
import { upsertSnippet, removeAllCapaSnippets, listCapaSnippetIds, removeSnippet } from './snippets';
import { readMdFile, writeMdFile, deleteMdFile } from './md-io';
import {
  fetchRemoteContent,
  detectRepoCoordsFromRawUrl,
  resolveRepoSnippet,
  type RepoFetchContext,
} from './remote';

const UNIVERSAL_AGENTS_FILENAME = 'AGENTS.md';

/**
 * Reserved marker id for the optional base content seeded by `agents.base`.
 */
const BASE_BLOCK_ID = '__base__';

/**
 * Determine which agent instruction filenames to manage based on the active providers.
 * Each provider declares the instructions filename it reads (e.g. `AGENTS.md` for
 * most universal-spec providers, `CLAUDE.md` for Claude Code, `replit.md` for Replit).
 *
 * Only filenames declared by an active provider are returned — capa never writes a
 * file that no configured provider will read. When no providers are passed (e.g. a
 * fresh `capa clean` with no record of a previous install), we fall back to the
 * union across the entire registry so legacy artefacts can still be cleaned up.
 */
export function getTargetFilenames(providers: string[]): string[] {
  const filenames = new Set<string>();
  const list = providers.length > 0 ? providers.map(getProvider).filter(Boolean) : getAllProviders();
  for (const p of list) {
    if (p?.instructions) {
      filenames.add(p.instructions.filename);
    }
  }
  if (filenames.size === 0) {
    filenames.add(UNIVERSAL_AGENTS_FILENAME);
  }
  return [...filenames];
}

function applyConfigToFile(
  projectPath: string,
  filename: string,
  hasBase: boolean,
  snippetBodies: Map<string, string>
): void {
  let content = readMdFile(projectPath, filename);

  const snippetEntries = [...snippetBodies.entries()].filter(([id]) => id !== BASE_BLOCK_ID);
  const currentIds = new Set<string>(snippetEntries.map(([id]) => id));

  if (hasBase) {
    const baseBody = snippetBodies.get(BASE_BLOCK_ID);
    if (baseBody === undefined) {
      throw new Error(
        `Internal error: hasBase=true but no '${BASE_BLOCK_ID}' entry in snippetBodies.`
      );
    }
    content = upsertSnippet(content, BASE_BLOCK_ID, baseBody);
    currentIds.add(BASE_BLOCK_ID);
  }

  for (const [id, body] of snippetEntries) {
    content = upsertSnippet(content, id, body);
  }

  for (const id of listCapaSnippetIds(content)) {
    if (!currentIds.has(id)) {
      taskLog(`  Removing stale agent snippet "${id}" from ${filename}`);
      content = removeSnippet(content, id);
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
      const resolvedPath = assertSafeRepoPath(capabilitiesDir, config.base.path);
      if (!existsSync(resolvedPath)) {
        throw new Error(
          `agents.base local file not found: ${resolvedPath} (resolved from path "${config.base.path}")`
        );
      }
      taskLog(`  Using base agents file from ${resolvedPath}`);
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
      taskLog(`  Fetching base agents file from ${baseType}:${config.base.def.repo}`);
      const result = await fetchRepoFile(
        baseType,
        config.base.def.repo,
        ctx.getRepoSnapshot,
        ctx.authFetch,
        { noCache: ctx.noCache }
      );
      baseContent = result.content;
    } else if (config.base.ref) {
      const repoCoords = detectRepoCoordsFromRawUrl(config.base.ref);
      if (repoCoords && ctx.authFetch && ctx.getRepoSnapshot) {
        taskLog(
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
        taskLog(`  Fetching base agents file from ${config.base.ref}`);
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

    snippetBodies.set(BASE_BLOCK_ID, applySecurityChecks(baseContent, 'agents:base'));
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
        taskLog(
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
        taskLog(`  Fetching remote snippet "${resolvedId}" from ${snippet.url}`);
        body = await fetchRemoteContent(snippet.url, {
          authFetch: ctx.authFetch,
          sourceLabel: `agents snippet "${resolvedId}"`,
        });
      }
    } else if (snippet.type === 'local') {
      if (!snippet.id) throw new Error(`Agent local snippet is missing an "id" field.`);
      if (!snippet.path) {
        throw new Error(
          `Agent snippet "${snippet.id}" is type 'local' but has no "path" field ` +
            `(e.g. "path: ./docs/team.md").`,
        );
      }
      if (!capabilitiesFilePath) {
        throw new Error(
          `Agent snippet "${snippet.id}" type 'local' requires the capabilities file path to resolve relative paths.`,
        );
      }
      resolvedId = snippet.id;
      const capabilitiesDir = dirname(capabilitiesFilePath);
      const resolvedPath = assertSafeRepoPath(capabilitiesDir, snippet.path);
      if (!existsSync(resolvedPath)) {
        throw new Error(
          `Agent snippet "${snippet.id}" local file not found: ${resolvedPath} ` +
            `(resolved from path "${snippet.path}")`,
        );
      }
      taskLog(`  Reading local snippet "${resolvedId}" from ${resolvedPath}`);
      body = readFileSync(resolvedPath, 'utf8');
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
    taskLog(`  ✓ ${filename} updated`);
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
      taskLog(`  ✓ Removed ${filename} (was entirely capa-managed)`);
    } else {
      writeMdFile(projectPath, filename, cleaned + '\n');
      taskLog(`  ✓ Removed capa snippets from ${filename}`);
    }
  }
}
