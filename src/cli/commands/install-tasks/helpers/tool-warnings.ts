import type { Capabilities } from '../../../../types/capabilities';
import { getQualifiedToolName, normalizeToolReference } from '../../../../types/capabilities';

// Tool IDs not exposed to MCP clients because no skill requires them. In
// both expose-all and on-demand modes only tools required by at least one
// skill are exposed; plugin tools follow the same rule.
export function getUnexposedToolIds(capabilities: Capabilities): string[] {
  const requiredBySkills = new Set<string>();
  for (const skill of capabilities.skills) {
    if (skill.def?.requires) {
      for (const ref of skill.def.requires) {
        requiredBySkills.add(normalizeToolReference(ref));
      }
    }
  }
  return capabilities.tools
    .map((t) => getQualifiedToolName(t))
    .filter((id) => !requiredBySkills.has(id));
}

// Warn for each user-declared `type: plugin` skill whose id is not exposed
// by any resolved plugin manifest — typo / stale reference detector.
export function collectPluginSkillWarnings(capabilities: Capabilities): string[] {
  const pluginSkills = capabilities.skills.filter((s) => s.type === 'plugin');
  if (pluginSkills.length === 0) return [];

  const exposedSkillIds = new Set<string>();
  for (const plugin of capabilities.resolvedPlugins ?? []) {
    for (const id of plugin.skills ?? []) {
      exposedSkillIds.add(id);
    }
  }

  const warnings: string[] = [];
  for (const skill of pluginSkills) {
    if (!skill.sourcePlugin && !exposedSkillIds.has(skill.id)) {
      const available = exposedSkillIds.size > 0
        ? `Plugin skills available: ${Array.from(exposedSkillIds).sort().join(', ')}`
        : 'No plugin currently exposes any skill.';
      warnings.push(
        `Plugin skill "${skill.id}" is declared but no configured plugin exposes a skill with that id. ${available}`,
      );
    }
  }
  return warnings;
}

// Warn for each subagent that references a skill or tool id that is not
// declared in the top-level `skills` / `tools` arrays. Today these typos
// pass silently: rendered files include junk bullets and the subagent loses
// access to the tool at runtime with no signal. One line per typo, so a
// `general-data-analyiss` mistake is obvious in install output.
export function collectSubagentRefWarnings(capabilities: Capabilities): string[] {
  const subagents = capabilities.subagents ?? [];
  if (subagents.length === 0) return [];

  const knownSkillIds = new Set(capabilities.skills.map((s) => s.id));
  const knownToolIds = new Set(capabilities.tools.map((t) => t.id));

  const warnings: string[] = [];
  for (const sa of subagents) {
    for (const skillId of sa.skills ?? []) {
      if (!knownSkillIds.has(skillId)) {
        warnings.push(
          `Subagent "${sa.id}" references unknown skill "${skillId}". ` +
          `Add it under top-level \`skills\` or remove it from the subagent.`,
        );
      }
    }
    for (const toolId of sa.tools ?? []) {
      if (!knownToolIds.has(toolId)) {
        warnings.push(
          `Subagent "${sa.id}" references unknown tool "${toolId}". ` +
          `Add it under top-level \`tools\` or remove it from the subagent.`,
        );
      }
    }
  }
  return warnings;
}

// Warn when a plugin server contributes tools but no user-declared tool
// references it. An unreferenced plugin server is almost always a misconfig.
export function collectUnreferencedPluginServerWarnings(capabilities: Capabilities): string[] {
  const resolved = capabilities.resolvedPlugins ?? [];
  if (resolved.length === 0) return [];

  const referencedServerIds = new Set<string>();
  for (const tool of capabilities.tools) {
    if (tool.type !== 'mcp') continue;
    const mcpDef = tool.def as { server?: string };
    if (mcpDef.server) {
      referencedServerIds.add(mcpDef.server.replace(/^@/, ''));
    }
  }

  const warnings: string[] = [];
  for (const plugin of resolved) {
    const orphanServers = (plugin.serverIds ?? []).filter((id) => !referencedServerIds.has(id));
    if (orphanServers.length === 0) continue;
    warnings.push(
      `Plugin "${plugin.id}" exposes server(s) [${orphanServers.join(', ')}] but no user-declared tool references them. ` +
        `Add entries in the \`tools\` section to expose them, e.g.: tools: - id: my_tool, type: mcp, def: { server: "@${orphanServers[0]}", tool: <remote_tool_name> }`,
    );
  }
  return warnings;
}
