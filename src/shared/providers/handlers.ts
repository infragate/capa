import { join } from 'path';
import TOML from '@iarna/toml';
import type { McpIntegration, ProviderIntegration, RulesIntegration } from '../../types/providers';
import type { SubAgent, Capabilities } from '../../types/capabilities';
import { getQualifiedToolName } from '../../types/capabilities';
import type { Rule } from '../../types/rules';

/**
 * Build the MCP server entry object from declarative integration data.
 * e.g. { url: 'http://...' }
 */
export function buildMcpEntry(mcp: McpIntegration, url: string): Record<string, unknown> {
  return { [mcp.entryUrlKey]: url };
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
 */
export function buildSubAgentFile(
  provider: ProviderIntegration,
  subAgent: SubAgent,
  capabilities: Capabilities
): string {
  const sa = provider.subagents!;
  const mcpServerKey = `capa-${subAgent.id}`;

  if (sa.format === 'markdown-frontmatter') {
    return buildMarkdownSubAgent(sa.fields ?? {}, subAgent, capabilities, mcpServerKey);
  }
  return buildTomlSubAgent(sa.fields ?? {}, sa.bodyField ?? 'developer_instructions', subAgent, capabilities, mcpServerKey);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveToolNames(subAgent: SubAgent, capabilities: Capabilities): string {
  return subAgent.tools
    .map((toolId) => {
      const tool = capabilities.tools.find((t) => t.id === toolId);
      return tool ? getQualifiedToolName(tool) : toolId;
    })
    .join(', ');
}

function buildMarkdownBody(subAgent: SubAgent, capabilities: Capabilities, mcpServerKey: string): string {
  const toolNames = resolveToolNames(subAgent, capabilities);
  const skillList = subAgent.skills.length > 0 ? subAgent.skills.join(', ') : '(none)';

  const lines: string[] = [
    `**MCP server key:** \`${mcpServerKey}\``,
    `**Skills:** ${skillList}`,
    `**Tools:** ${toolNames || '(none)'}`,
  ];

  if (subAgent.instructions) {
    lines.push('', subAgent.instructions.trimEnd());
  }

  return lines.join('\n');
}

function buildPlainBody(subAgent: SubAgent, capabilities: Capabilities, mcpServerKey: string): string {
  const toolNames = resolveToolNames(subAgent, capabilities);
  const skillList = subAgent.skills.length > 0 ? subAgent.skills.join(', ') : '(none)';

  const lines: string[] = [
    `MCP server key: ${mcpServerKey}`,
    `Skills: ${skillList}`,
    `Tools: ${toolNames || '(none)'}`,
  ];

  if (subAgent.instructions) {
    lines.push('', subAgent.instructions.trimEnd());
  }

  return lines.join('\n');
}

function buildMarkdownSubAgent(
  fields: Record<string, string | boolean | number>,
  subAgent: SubAgent,
  capabilities: Capabilities,
  mcpServerKey: string
): string {
  const body = buildMarkdownBody(subAgent, capabilities, mcpServerKey);
  const description = subAgent.description || subAgent.id;

  const fmLines: string[] = [
    '---',
    `name: ${subAgent.id}`,
    `description: ${description}`,
  ];

  for (const [key, value] of Object.entries(fields)) {
    fmLines.push(`${key}: ${value}`);
  }

  fmLines.push('---');

  return [...fmLines, '', body, ''].join('\n');
}

function buildTomlSubAgent(
  fields: Record<string, string | boolean | number>,
  bodyField: string,
  subAgent: SubAgent,
  capabilities: Capabilities,
  mcpServerKey: string
): string {
  const body = buildPlainBody(subAgent, capabilities, mcpServerKey);

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
