import { join } from 'path';
import TOML from '@iarna/toml';
import type {
  McpIntegration,
  ProviderIntegration,
  RulesIntegration,
  SubagentsIntegration,
} from '../../types/providers';
import type { SubAgent, Capabilities } from '../../types/capabilities';
import { getQualifiedToolName, resolveSubagentToolRef } from '../../types/capabilities';
import { slugify } from '../slug';
import type { Rule } from '../../types/rules';

/**
 * Build the MCP server entry object from declarative integration data.
 * e.g. { url: 'http://...' }
 */
export function buildMcpEntry(mcp: McpIntegration, url: string): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  if (mcp.entryType) entry.type = mcp.entryType;
  entry[mcp.entryUrlKey] = url;
  if (mcp.entryExtraFields) Object.assign(entry, mcp.entryExtraFields);
  return entry;
}

/**
 * Resolve the absolute MCP config file path for a provider.
 */
export function getMcpConfigPath(provider: ProviderIntegration, projectPath: string): string {
  return join(projectPath, provider.mcp!.configPath);
}

/**
 * Build frontmatter fields for a rule file from the provider's fieldMap.
 * Returns an empty object if no fields apply.
 */
export function buildRuleFrontmatter(
  rules: RulesIntegration,
  rule: Pick<Rule, 'id' | 'description' | 'appliesTo' | 'alwaysApply'>
): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  if (!rules.fieldMap) return fm;

  const { fieldMap } = rules;
  if (fieldMap.description && rule.description) {
    fm[fieldMap.description] = rule.description;
  }
  if (fieldMap.appliesTo && rule.appliesTo && rule.appliesTo.length > 0) {
    fm[fieldMap.appliesTo] = rule.appliesTo;
  }
  if (fieldMap.alwaysApply) {
    if (fieldMap.alwaysApplyValues) {
      fm[fieldMap.alwaysApply] = rule.alwaysApply
        ? fieldMap.alwaysApplyValues.trueValue
        : fieldMap.alwaysApplyValues.falseValue;
    } else if (rule.alwaysApply) {
      fm[fieldMap.alwaysApply] = true;
    }
  }
  return fm;
}

/**
 * Build the complete file content for a sub-agent definition.
 * Interprets the provider's `subagents` descriptor to produce either
 * markdown-frontmatter or TOML output.
 *
 * `skillDescriptions` maps skill id → description (sourced from the skill's
 * SKILL.md frontmatter at install time). Optional; missing entries render
 * the bare skill id without an em-dash.
 */
export function buildSubAgentFile(
  provider: ProviderIntegration,
  subAgent: SubAgent,
  capabilities: Capabilities,
  skillDescriptions: Map<string, string> = new Map()
): string {
  const sa = provider.subagents!;
  const mcpServerKey = `capa-${subAgent.id}`;

  if (sa.format === 'markdown-frontmatter') {
    return buildMarkdownSubAgent(
      sa.fields ?? {},
      sa.perAgentToolScope,
      subAgent,
      capabilities,
      mcpServerKey,
      skillDescriptions
    );
  }
  return buildTomlSubAgent(
    sa.fields ?? {},
    sa.bodyField ?? 'developer_instructions',
    subAgent,
    capabilities,
    mcpServerKey,
    skillDescriptions
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Translate a qualified tool name (e.g. `dbx.sql_read_only` or `getJiraIssue`)
 * into the equivalent `capa sh` invocation. Each segment is slugified the same
 * way the shell registry does (`snake_case`/`camelCase` → `kebab-case`), so the
 * printed form is exactly what the user types — e.g.
 * `dbx.sql_read_only` → `capa sh dbx sql-read-only`. Ungrouped command tools
 * collapse to `capa sh <tool>`.
 */
function qualifiedToCapaSh(qualified: string): string {
  return `capa sh ${qualified.split('.').map(slugify).join(' ')}`;
}

interface ResolvedTool {
  toolId: string;
  qualified: string;
  capaSh: string;
  description?: string;
}

function resolveTool(toolRef: string, capabilities: Capabilities): ResolvedTool {
  // toolRef may be "@server.tool", "server.tool", or a bare local id —
  // resolveSubagentToolRef handles all three. When nothing matches we fall
  // back to the raw ref so the bullet still renders (and the new
  // collectSubagentRefWarnings surfaces the typo separately).
  const tool = resolveSubagentToolRef(toolRef, capabilities.tools);
  const qualified = tool ? getQualifiedToolName(tool) : toolRef;
  return {
    toolId: toolRef,
    qualified,
    capaSh: qualifiedToCapaSh(qualified),
    description: tool?.description,
  };
}

function renderSkillsBlock(
  subAgent: SubAgent,
  skillDescriptions: Map<string, string>,
  opts: { backtick: boolean }
): string[] {
  const header = opts.backtick ? '**Skills:**' : 'Skills:';
  if (subAgent.skills.length === 0) {
    return [header, '- (none)'];
  }
  const bullets = subAgent.skills.map((skillId) => {
    const desc = skillDescriptions.get(skillId);
    const name = opts.backtick ? `\`${skillId}\`` : skillId;
    return desc ? `- ${name} — ${desc}` : `- ${name}`;
  });
  return [header, ...bullets];
}

function renderToolsBlock(
  subAgent: SubAgent,
  capabilities: Capabilities,
  opts: { backtick: boolean }
): string[] {
  const header = opts.backtick ? '**Tools:**' : 'Tools:';
  if (subAgent.tools.length === 0) {
    return [header, '- (none)'];
  }
  const bullets = subAgent.tools.map((toolId) => {
    const { qualified, capaSh, description } = resolveTool(toolId, capabilities);
    const name = opts.backtick ? `\`${qualified}\`` : qualified;
    const cli = opts.backtick ? `\`${capaSh}\`` : capaSh;
    const prefix = `- ${name} (${cli})`;
    return description ? `${prefix} — ${description}` : prefix;
  });
  return [header, ...bullets];
}

function buildMarkdownBody(
  subAgent: SubAgent,
  capabilities: Capabilities,
  mcpServerKey: string,
  skillDescriptions: Map<string, string>
): string {
  const lines: string[] = [
    `**MCP server key:** \`${mcpServerKey}\``,
    '',
    ...renderSkillsBlock(subAgent, skillDescriptions, { backtick: true }),
    '',
    ...renderToolsBlock(subAgent, capabilities, { backtick: true }),
  ];

  if (subAgent.instructions) {
    lines.push('', subAgent.instructions.trimEnd());
  }

  return lines.join('\n');
}

function buildPlainBody(
  subAgent: SubAgent,
  capabilities: Capabilities,
  mcpServerKey: string,
  skillDescriptions: Map<string, string>
): string {
  const lines: string[] = [
    `MCP server key: ${mcpServerKey}`,
    '',
    ...renderSkillsBlock(subAgent, skillDescriptions, { backtick: false }),
    '',
    ...renderToolsBlock(subAgent, capabilities, { backtick: false }),
  ];

  if (subAgent.instructions) {
    lines.push('', subAgent.instructions.trimEnd());
  }

  return lines.join('\n');
}

function buildMarkdownSubAgent(
  fields: Record<string, string | boolean | number>,
  perAgentToolScope: SubagentsIntegration['perAgentToolScope'] | undefined,
  subAgent: SubAgent,
  capabilities: Capabilities,
  mcpServerKey: string,
  skillDescriptions: Map<string, string>
): string {
  const body = buildMarkdownBody(subAgent, capabilities, mcpServerKey, skillDescriptions);
  const description = subAgent.description || subAgent.id;

  const fmLines: string[] = [
    '---',
    `name: ${subAgent.id}`,
    `description: ${description}`,
  ];

  for (const [key, value] of Object.entries(fields)) {
    fmLines.push(`${key}: ${value}`);
  }

  if (perAgentToolScope) {
    const pattern = perAgentToolScope.patternTemplate.replace('{id}', subAgent.id);
    // Quote the glob — `*` is a YAML reserved char if it leads a token.
    fmLines.push(`${perAgentToolScope.key}:`, `  "${pattern}": ${perAgentToolScope.value}`);
  }

  fmLines.push('---');

  return [...fmLines, '', body, ''].join('\n');
}

function buildTomlSubAgent(
  fields: Record<string, string | boolean | number>,
  bodyField: string,
  subAgent: SubAgent,
  capabilities: Capabilities,
  mcpServerKey: string,
  skillDescriptions: Map<string, string>
): string {
  const body = buildPlainBody(subAgent, capabilities, mcpServerKey, skillDescriptions);

  const data: Record<string, any> = {
    name: subAgent.id,
    description: subAgent.description || subAgent.id,
    ...fields,
    [bodyField]: body,
    mcp_servers: {
      [mcpServerKey]: {
        url: '',
      },
    },
  };

  return TOML.stringify(data as any);
}

/**
 * Exported for use by `agents-file.ts` when rendering the dashed skill/tool
 * blocks into the universal AGENTS.md/CLAUDE.md sub-agent snippet.
 */
export function renderSubAgentSkillsAndTools(
  subAgent: SubAgent,
  capabilities: Capabilities,
  skillDescriptions: Map<string, string>
): string[] {
  return [
    ...renderSkillsBlock(subAgent, skillDescriptions, { backtick: true }),
    '',
    ...renderToolsBlock(subAgent, capabilities, { backtick: true }),
  ];
}

