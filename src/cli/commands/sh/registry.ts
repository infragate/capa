import { slugify } from '../../../shared/slug';
import { getQualifiedToolName } from '../../../types/capabilities';
import type { Capabilities } from '../../../types/capabilities';
import { buildArgSlugs } from './args';

export interface ShellToolInfo {
  id: string;
  type: 'command' | 'mcp';
  serverId?: string;
  serverDescription?: string;
  group?: string;
  description: string;
  inputSchema: any;
  defaults?: Record<string, any>;
}

export interface ShellCommand {
  id: string;
  slug: string;
  type: 'command' | 'mcp';
  description: string;
  inputSchema: any;
  /** Maps slugified arg name → original arg name */
  argSlugs: Map<string, string>;
  /** Default argument values */
  defaults?: Record<string, any>;
  /**
   * Whether `inputSchema` is populated. Command tools ship their schema with the
   * metadata listing; MCP tool schemas are fetched lazily (see ensureSchema) only
   * when the tool is run or `--help`'d, so this is false for them until resolved.
   */
  schemaLoaded: boolean;
}

export interface ShellGroup {
  id: string;
  slug: string;
  description?: string;
  commands: Map<string, ShellCommand>;
  /** true = came from an MCP server, false = came from command tool `group` field */
  isMcp: boolean;
}

export class ShellRegistry {
  topLevelCommands = new Map<string, ShellCommand>();
  groups = new Map<string, ShellGroup>();

  build(tools: ShellToolInfo[]): void {
    // First pass: collect all command-group members so we can apply the
    // "single-subcommand → promote to top level" rule after.
    const pendingCommandGroups = new Map<string, { slug: string; tools: ShellToolInfo[] }>();

    for (const tool of tools) {
      const commandSlug = slugify(tool.id);
      const argSlugs = buildArgSlugs(tool.inputSchema);

      const cmd: ShellCommand = {
        id: tool.id,
        slug: commandSlug,
        type: tool.type,
        description: tool.description,
        inputSchema: tool.inputSchema,
        argSlugs,
        defaults: tool.defaults,
        schemaLoaded: tool.type === 'command',
      };

      if (tool.type === 'mcp' && tool.serverId) {
        const groupSlug = slugify(tool.serverId);
        if (!this.groups.has(groupSlug)) {
          this.groups.set(groupSlug, {
            id: tool.serverId,
            slug: groupSlug,
            description: tool.serverDescription,
            commands: new Map(),
            isMcp: true,
          });
        }
        const dotIdx = tool.id.indexOf('.');
        const shortName = dotIdx >= 0 ? tool.id.slice(dotIdx + 1) : tool.id;
        const subSlug = slugify(shortName);
        cmd.slug = subSlug;
        this.groups.get(groupSlug)!.commands.set(subSlug, cmd);
      } else if (tool.group) {
        const groupSlug = slugify(tool.group);
        if (!pendingCommandGroups.has(groupSlug)) {
          pendingCommandGroups.set(groupSlug, { slug: groupSlug, tools: [] });
        }
        pendingCommandGroups.get(groupSlug)!.tools.push(tool);
      } else {
        this.topLevelCommands.set(commandSlug, cmd);
      }
    }

    // Second pass: resolve command groups.
    // Groups with a single member are promoted to top-level commands.
    for (const [groupSlug, { tools: groupTools }] of pendingCommandGroups) {
      if (groupTools.length === 1) {
        const tool = groupTools[0];
        const dotIdx = tool.id.indexOf('.');
        const shortName = dotIdx >= 0 ? tool.id.slice(dotIdx + 1) : tool.id;
        const commandSlug = slugify(shortName);
        this.topLevelCommands.set(commandSlug, {
          id: tool.id,
          slug: commandSlug,
          type: tool.type,
          description: tool.description,
          inputSchema: tool.inputSchema,
          argSlugs: buildArgSlugs(tool.inputSchema),
          schemaLoaded: tool.type === 'command',
        });
      } else {
        const group: ShellGroup = {
          id: groupTools[0].group!,
          slug: groupSlug,
          commands: new Map(),
          isMcp: false,
        };
        for (const tool of groupTools) {
          const dotIdx = tool.id.indexOf('.');
          const shortName = dotIdx >= 0 ? tool.id.slice(dotIdx + 1) : tool.id;
          const commandSlug = slugify(shortName);
          group.commands.set(commandSlug, {
            id: tool.id,
            slug: commandSlug,
            type: tool.type,
            description: tool.description,
            inputSchema: tool.inputSchema,
            argSlugs: buildArgSlugs(tool.inputSchema),
            schemaLoaded: tool.type === 'command',
          });
        }
        this.groups.set(groupSlug, group);
      }
    }
  }
}

/**
 * Overlay metadata from the local capabilities file onto the server's tool list.
 * The server may have stale capabilities (last set by `capa install`), so we always
 * prefer the local file for: tool description, tool group, and MCP server description.
 */
export function applyLocalMetadata(tools: ShellToolInfo[], capabilities: Capabilities): ShellToolInfo[] {
  const localToolMap = new Map(capabilities.tools.map((t) => [getQualifiedToolName(t), t]));
  const localServerMap = new Map(capabilities.servers.map((s) => [s.id, s]));

  return tools.map((tool) => {
    const result = { ...tool };
    const localTool = localToolMap.get(tool.id);

    if (localTool?.description) {
      result.description = localTool.description;
    }

    if (tool.type === 'command' && localTool?.group) {
      result.group = localTool.group;
    }

    if (tool.type === 'mcp' && tool.serverId) {
      const localServer = localServerMap.get(tool.serverId);
      if (localServer?.description) {
        result.serverDescription = localServer.description;
      }
    }

    return result;
  });
}
