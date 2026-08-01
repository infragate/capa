import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import type { SubAgent, Capabilities } from '../../../types/capabilities';
import { getProvider } from '../../../shared/providers';
import {
  buildSubAgentFile as buildSubAgentFileContent,
  renderSubAgentSkillsAndTools,
} from '../../../shared/providers/handlers';
import { taskLog } from '../../ui';
import { readMdFile, writeMdFile } from './md-io';
import { upsertSnippet, removeSnippet } from './snippets';

function writesSubAgentInstructionsContext(provider: NonNullable<ReturnType<typeof getProvider>>): boolean {
  if (!provider.instructions) return false;
  if (provider.subagents) return false;
  return provider.foldSubAgentsIntoInstructions === true;
}

function upsertSubAgentInstructionsSnippet(
  projectPath: string,
  provider: NonNullable<ReturnType<typeof getProvider>>,
  subAgent: SubAgent,
  capabilities: Capabilities,
  skillDescriptions: Map<string, string>
): void {
  if (!provider.instructions) return;

  const mcpServerKey = `capa-${subAgent.id}`;
  const snippetId = `sub-agent:${subAgent.id}`;
  const bodyLines = [
    `## Agent: ${subAgent.id}`,
    ...(subAgent.description ? ['', subAgent.description] : []),
    '',
    `**MCP server key:** \`${mcpServerKey}\``,
    '',
    ...renderSubAgentSkillsAndTools(subAgent, capabilities, skillDescriptions),
  ];
  if (subAgent.instructions) {
    bodyLines.push('', subAgent.instructions.trimEnd());
  }

  const filename = provider.instructions.filename;
  let content = readMdFile(projectPath, filename);
  content = upsertSnippet(content, snippetId, bodyLines.join('\n'));
  writeMdFile(projectPath, filename, content);
  taskLog(`  ✓ ${filename} updated with sub-agent "${subAgent.id}" instructions`);
}

function removeSubAgentInstructionsSnippet(
  projectPath: string,
  provider: NonNullable<ReturnType<typeof getProvider>>,
  agentId: string
): void {
  if (!provider.instructions) return;

  const snippetId = `sub-agent:${agentId}`;
  const filename = provider.instructions.filename;
  const content = readMdFile(projectPath, filename);
  if (content) {
    writeMdFile(projectPath, filename, removeSnippet(content, snippetId));
    taskLog(`  ✓ Removed sub-agent "${agentId}" instructions from ${filename}`);
  }
}

function writeSubAgentFile(
  projectPath: string,
  providerId: string,
  subAgent: SubAgent,
  capabilities: Capabilities,
  skillDescriptions: Map<string, string>
): void {
  const provider = getProvider(providerId);
  if (!provider?.subagents) return;

  const { subagents: sa } = provider;
  const agentsDir = join(projectPath, sa.dir);
  mkdirSync(agentsDir, { recursive: true });

  const agentsDirResolved = resolve(agentsDir);
  const filePath = resolve(agentsDir, `${subAgent.id}${sa.extension}`);
  const rel = relative(agentsDirResolved, filePath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    taskLog(
      `  ⚠ Skipping subagent "${subAgent.id}": id escapes ${sa.dir} (refusing path traversal)`,
    );
    return;
  }

  const content = buildSubAgentFileContent(provider, subAgent, capabilities, skillDescriptions);
  writeFileSync(filePath, content, 'utf8');

  taskLog(`  ✓ ${sa.dir}/${subAgent.id}${sa.extension} written`);
}

function removeSubAgentFile(projectPath: string, providerId: string, agentId: string): void {
  const provider = getProvider(providerId);
  if (!provider?.subagents) return;

  const { subagents: sa } = provider;
  const filePath = join(projectPath, sa.dir, `${agentId}${sa.extension}`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    taskLog(`  ✓ Removed ${sa.dir}/${agentId}${sa.extension}`);
  }
}

/**
 * Install sub-agent definition files for each active provider.
 *
 * For providers with a `subagents` integration, writes the agent file using
 * the provider-specific format (markdown frontmatter or TOML). That file is
 * the sole source of truth — the primary instructions file (CLAUDE.md,
 * AGENTS.md, …) is intentionally left untouched so we don't bloat the main
 * agent's context with the same content the sub-agent file already carries.
 *
 * For providers without separate sub-agent files, folds context into the
 * instructions file ONLY when `foldSubAgentsIntoInstructions: true` is set.
 */
export function installSubAgentInstructions(
  projectPath: string,
  subAgent: SubAgent,
  capabilities: Capabilities,
  providers: string[],
  skillDescriptions: Map<string, string> = new Map()
): void {
  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider) continue;

    if (provider.subagents) {
      writeSubAgentFile(projectPath, pid, subAgent, capabilities, skillDescriptions);
    }
    if (writesSubAgentInstructionsContext(provider)) {
      upsertSubAgentInstructionsSnippet(
        projectPath,
        provider,
        subAgent,
        capabilities,
        skillDescriptions
      );
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
    if (writesSubAgentInstructionsContext(provider)) {
      removeSubAgentInstructionsSnippet(projectPath, provider, agentId);
    }
  }
}
