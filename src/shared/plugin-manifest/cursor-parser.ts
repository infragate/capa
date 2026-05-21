import { getProvider } from '../providers';
import type { UnifiedPluginManifest } from '../../types/plugin';
import {
  isPlainObject,
  parseSkillsField,
  parseSkillsRaw,
} from './types-helpers';
import { parseMcpServers } from './mcp-parser';

export function parseCursorManifest(
  repoRoot: string,
  data: unknown,
  manifestDir: string = '.cursor-plugin',
): UnifiedPluginManifest {
  const record = isPlainObject(data) ? data : {};
  const name = typeof record.name === 'string' ? record.name : 'unknown';
  const skills = parseSkillsField(repoRoot, parseSkillsRaw(record.skills), 'skills');
  const fallback = getProvider('cursor')?.mcp?.defaultMcpFallbackPath;
  const mcpServers = parseMcpServers(repoRoot, data, fallback, manifestDir);

  return {
    name,
    version: typeof record.version === 'string' ? record.version : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    provider: 'cursor',
    skillEntries: skills,
    mcpServers,
  };
}
