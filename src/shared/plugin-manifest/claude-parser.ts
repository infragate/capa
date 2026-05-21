import { getProvider, getProviderByPluginProviderId } from '../providers';
import type { UnifiedPluginManifest } from '../../types/plugin';
import {
  isPlainObject,
  parseSkillsField,
  parseSkillsRaw,
} from './types-helpers';
import { parseMcpServers } from './mcp-parser';

export function parseClaudeManifest(repoRoot: string, data: unknown): UnifiedPluginManifest {
  const record = isPlainObject(data) ? data : {};
  const name = typeof record.name === 'string' ? record.name : 'unknown';
  const skills = parseSkillsField(repoRoot, parseSkillsRaw(record.skills), 'skills');
  const fallback =
    getProvider('claude-code')?.mcp?.defaultMcpFallbackPath ??
    getProviderByPluginProviderId('claude')?.mcp?.defaultMcpFallbackPath;
  const mcpServers = parseMcpServers(repoRoot, data, fallback);

  return {
    name,
    version: typeof record.version === 'string' ? record.version : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    provider: 'claude',
    skillEntries: skills,
    mcpServers,
  };
}
