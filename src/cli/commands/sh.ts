import { detectCapabilitiesFile, generateProjectId } from '../../shared/paths';
import { parseCapabilitiesFile } from '../../shared/capabilities';
import { getServerStatus } from '../utils/server-manager';
import type { Capabilities } from '../../types/capabilities';

interface ShellToolInfo {
  id: string;
  type: 'command' | 'mcp';
  serverId?: string;
  serverDescription?: string;
  group?: string;
  description: string;
  inputSchema: any;
}

interface ShellCommand {
  id: string;
  slug: string;
  type: 'command' | 'mcp';
  description: string;
  inputSchema: any;
  /** Maps slugified arg name → original arg name */
  argSlugs: Map<string, string>;
}

interface ShellGroup {
  id: string;
  slug: string;
  description?: string;
  commands: Map<string, ShellCommand>;
  /** true = came from an MCP server, false = came from command tool `group` field */
  isMcp: boolean;
}

class ShellRegistry {
  topLevelCommands = new Map<string, ShellCommand>();
  groups = new Map<string, ShellGroup>();

  build(tools: ShellToolInfo[]): void {
    // First pass: collect all command-group members so we can apply the
    // "single-subcommand → promote to top level" rule after.
    const pendingCommandGroups = new Map<string, { slug: string; tools: ShellToolInfo[] }>();

    for (const tool of tools) {
      const commandSlug = slugify(tool.id);
      const argSlugs = new Map<string, string>();

      const props = tool.inputSchema?.properties || {};
      for (const argName of Object.keys(props)) {
        argSlugs.set(slugify(argName), argName);
      }

      const cmd: ShellCommand = {
        id: tool.id,
        slug: commandSlug,
        type: tool.type,
        description: tool.description,
        inputSchema: tool.inputSchema,
        argSlugs,
      };

      if (tool.type === 'mcp' && tool.serverId) {
        // MCP tools always form a group keyed by server ID
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
        this.groups.get(groupSlug)!.commands.set(commandSlug, cmd);
      } else if (tool.group) {
        // Command tool with an explicit group — collect for second pass
        const groupSlug = slugify(tool.group);
        if (!pendingCommandGroups.has(groupSlug)) {
          pendingCommandGroups.set(groupSlug, { slug: groupSlug, tools: [] });
        }
        pendingCommandGroups.get(groupSlug)!.tools.push(tool);
      } else {
        this.topLevelCommands.set(commandSlug, cmd);
      }
    }

    // Second pass: resolve command groups
    // Groups with a single member are promoted to top-level commands.
    for (const [groupSlug, { tools: groupTools }] of pendingCommandGroups) {
      if (groupTools.length === 1) {
        // Promote the sole tool directly to the top level
        const tool = groupTools[0];
        const commandSlug = slugify(tool.id);
        const argSlugs = new Map<string, string>();
        const props = tool.inputSchema?.properties || {};
        for (const argName of Object.keys(props)) {
          argSlugs.set(slugify(argName), argName);
        }
        this.topLevelCommands.set(commandSlug, {
          id: tool.id,
          slug: commandSlug,
          type: tool.type,
          description: tool.description,
          inputSchema: tool.inputSchema,
          argSlugs,
        });
      } else {
        // Create the group
        const group: ShellGroup = {
          id: groupTools[0].group!,
          slug: groupSlug,
          commands: new Map(),
          isMcp: false,
        };
        for (const tool of groupTools) {
          const commandSlug = slugify(tool.id);
          const argSlugs = new Map<string, string>();
          const props = tool.inputSchema?.properties || {};
          for (const argName of Object.keys(props)) {
            argSlugs.set(slugify(argName), argName);
          }
          group.commands.set(commandSlug, {
            id: tool.id,
            slug: commandSlug,
            type: tool.type,
            description: tool.description,
            inputSchema: tool.inputSchema,
            argSlugs,
          });
        }
        this.groups.set(groupSlug, group);
      }
    }
  }
}

export function slugify(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseInlineArgs(tokens: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
        result[key] = tokens[i + 1];
        i += 2;
      } else {
        result[key] = 'true';
        i++;
      }
    } else {
      i++;
    }
  }
  return result;
}

/** Resolve slugified arg names in the user's input to original names expected by the tool. */
function resolveArgs(cmd: ShellCommand, rawArgs: Record<string, string>): Record<string, any> {
  const resolved: Record<string, any> = {};
  for (const [slug, value] of Object.entries(rawArgs)) {
    const originalName = cmd.argSlugs.get(slug) ?? slug;
    const propSchema = cmd.inputSchema?.properties?.[originalName];
    if (propSchema?.type === 'number') {
      resolved[originalName] = Number(value);
    } else if (propSchema?.type === 'boolean') {
      resolved[originalName] = value !== 'false' && value !== '0';
    } else {
      resolved[originalName] = value;
    }
  }
  return resolved;
}

async function fetchShellTools(serverUrl: string, projectId: string): Promise<ShellToolInfo[]> {
  const response = await fetch(`${serverUrl}/api/projects/${projectId}/shell-tools`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to fetch shell tools (${response.status}): ${body}`);
  }
  const data = await response.json() as { tools: ShellToolInfo[] };
  return data.tools;
}

async function executeToolViaMCP(
  serverUrl: string,
  projectId: string,
  toolId: string,
  args: Record<string, any>
): Promise<string> {
  // Send initialize first to establish a session (needed for on-demand mode)
  await fetch(`${serverUrl}/${projectId}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'capa-shell', version: '1.0' },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  const response = await fetch(`${serverUrl}/${projectId}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: toolId, arguments: args },
    }),
    signal: AbortSignal.timeout(60000),
  });

  const data = await response.json() as any;

  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  const content = data.result?.content;
  if (Array.isArray(content) && content.length > 0) {
    return content.map((c: any) => (typeof c.text === 'string' ? c.text : JSON.stringify(c))).join('\n');
  }
  return JSON.stringify(data.result ?? data, null, 2);
}

async function runPassthrough(tokens: string[]): Promise<void> {
  const command = tokens.join(' ');
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const shellFlag = isWindows ? '/C' : '-c';

  const proc = Bun.spawn([shell, shellFlag, command], {
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  await proc.exited;
}

function buildArgList(cmd: ShellCommand): string {
  const props = cmd.inputSchema?.properties || {};
  const required: string[] = cmd.inputSchema?.required || [];
  const parts: string[] = [];
  for (const argName of Object.keys(props)) {
    const slug = slugify(argName);
    const isRequired = required.includes(argName);
    parts.push(isRequired ? `--${slug}*` : `[--${slug}]`);
  }
  return parts.join(' ');
}

function groupDescription(group: ShellGroup): string {
  if (group.description) return group.description;
  const n = group.commands.size;
  return `${n} subcommand${n === 1 ? '' : 's'} available`;
}

function printAvailableCommands(registry: ShellRegistry): void {
  console.log('\nCapa Shell - Available commands:\n');
  const colWidth = 24;

  if (registry.groups.size > 0) {
    for (const [slug, group] of registry.groups) {
      const padding = ' '.repeat(Math.max(1, colWidth - slug.length));
      console.log(`  ${slug}${padding}${groupDescription(group)}`);
    }
  }

  if (registry.topLevelCommands.size > 0) {
    for (const [slug, cmd] of registry.topLevelCommands) {
      const padding = ' '.repeat(Math.max(1, colWidth - slug.length));
      const desc = cmd.description ? cmd.description.split('\n')[0].slice(0, 60) : '';
      console.log(`  ${slug}${padding}${desc}`);
    }
  }

  console.log('\nUsage:');
  console.log('  capa sh                              Show this help');
  console.log('  capa sh <group>                      List tools in a group');
  console.log('  capa sh <group> <tool> [--arg val]   Run a tool');
  console.log('  capa sh <command> [--arg val]        Run a top-level command');
  console.log('  capa sh <other>                      Pass through to OS shell\n');
}

function printGroupHelp(group: ShellGroup): void {
  if (group.commands.size === 0) {
    console.log(`  ${group.slug} has no available subcommands.`);
    return;
  }
  console.log(`\n${group.slug} - subcommands:\n`);
  for (const [slug, cmd] of group.commands) {
    const desc = cmd.description ? '  — ' + cmd.description.split('\n')[0].slice(0, 70) : '';
    const argList = buildArgList(cmd);
    console.log(`  ${slug}${argList ? '  ' + argList : ''}${desc}`);
  }
  console.log('');
}

function printCommandHelp(cmd: ShellCommand): void {
  console.log('');
  if (cmd.description) {
    console.log(`  ${cmd.slug}  —  ${cmd.description.split('\n')[0]}`);
  } else {
    console.log(`  ${cmd.slug}`);
  }
  const props = cmd.inputSchema?.properties || {};
  const required: string[] = cmd.inputSchema?.required || [];
  if (Object.keys(props).length > 0) {
    console.log('\n  Arguments:\n');
    for (const [argName, schema] of Object.entries(props) as [string, any][]) {
      const slug = slugify(argName);
      const isRequired = required.includes(argName);
      const typeStr = schema.type ? `<${schema.type}>` : '';
      const descStr = schema.description ? `  ${schema.description}` : '';
      const reqStr = isRequired ? ' (required)' : '';
      console.log(`    --${slug} ${typeStr}${reqStr}${descStr}`);
    }
  }
  console.log('');
}

async function execCommand(
  cmd: ShellCommand,
  rawArgTokens: string[],
  serverUrl: string,
  projectId: string
): Promise<void> {
  const rawArgs = parseInlineArgs(rawArgTokens);
  const resolved = resolveArgs(cmd, rawArgs);

  const required: string[] = cmd.inputSchema?.required || [];
  const missingRequired = required.filter((r) => !(slugify(r) in rawArgs) && !(r in rawArgs));
  if (missingRequired.length > 0) {
    console.error(`Missing required argument(s): ${missingRequired.map((r) => `--${slugify(r)}`).join(', ')}`);
    const argList = buildArgList(cmd);
    console.error(`Usage: capa sh ${cmd.slug}${argList ? ' ' + argList : ''}`);
    process.exit(1);
  }

  const result = await executeToolViaMCP(serverUrl, projectId, cmd.id, resolved);
  try {
    const parsed = JSON.parse(result);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(result);
  }
}

function isHelpFlag(token: string): boolean {
  return token === '--help' || token === '-h' || token === 'help';
}

async function dispatch(
  tokens: string[],
  registry: ShellRegistry,
  serverUrl: string,
  projectId: string
): Promise<void> {
  if (tokens.length === 0) {
    printAvailableCommands(registry);
    return;
  }

  const first = tokens[0];
  const rest = tokens.slice(1);

  // `capa sh --help` / `capa sh help` → show all commands
  if (isHelpFlag(first)) {
    printAvailableCommands(registry);
    return;
  }

  // Group command
  if (registry.groups.has(first)) {
    const group = registry.groups.get(first)!;

    // `capa sh <group>` or `capa sh <group> --help` → list subcommands
    if (rest.length === 0 || isHelpFlag(rest[0])) {
      printGroupHelp(group);
      return;
    }

    const subSlug = rest[0];
    const subRest = rest.slice(1);

    if (!group.commands.has(subSlug)) {
      const available = Array.from(group.commands.keys()).join(', ');
      console.error(`No such subcommand: "${subSlug}"`);
      console.error(`Available subcommands: ${available}`);
      process.exit(1);
    }

    const cmd = group.commands.get(subSlug)!;

    // `capa sh <group> <subcommand> --help` → show command arg info
    if (subRest.length > 0 && isHelpFlag(subRest[0])) {
      printCommandHelp(cmd);
      return;
    }

    await execCommand(cmd, subRest, serverUrl, projectId);
    return;
  }

  // Top-level capa command
  if (registry.topLevelCommands.has(first)) {
    const cmd = registry.topLevelCommands.get(first)!;

    // `capa sh <command> --help` → show command arg info
    if (rest.length > 0 && isHelpFlag(rest[0])) {
      printCommandHelp(cmd);
      return;
    }

    await execCommand(cmd, rest, serverUrl, projectId);
    return;
  }

  // Unknown — pass through to OS shell (including any --help flags)
  await runPassthrough(tokens);
}

/**
 * Overlay metadata from the local capabilities file onto the server's tool list.
 * The server may have stale capabilities (last set by `capa install`), so we always
 * prefer the local file for: tool description, tool group, and MCP server description.
 */
function applyLocalMetadata(tools: ShellToolInfo[], capabilities: Capabilities): ShellToolInfo[] {
  const localToolMap = new Map(capabilities.tools.map((t) => [t.id, t]));
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

export async function shellCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();

  const capFile = await detectCapabilitiesFile(cwd);
  if (!capFile) {
    console.error('No capabilities file found in the current directory.');
    console.error('Run "capa init" to create one, then "capa install" to configure it.');
    process.exit(1);
  }

  const status = await getServerStatus();
  if (!status.running || !status.url) {
    console.error('Capa server is not running. Start it with "capa start".');
    process.exit(1);
  }

  const serverUrl = status.url;
  const capabilities = await parseCapabilitiesFile(capFile.path, capFile.format);
  const projectId = generateProjectId(cwd);

  let tools: ShellToolInfo[];
  try {
    tools = await fetchShellTools(serverUrl, projectId);
  } catch (err: any) {
    console.error(`Failed to load tools: ${err.message}`);
    console.error('Make sure the project has been installed ("capa install").');
    process.exit(1);
  }

  // Always overlay metadata from the local file so descriptions/groups are
  // up to date even if the server has stale capabilities.
  tools = applyLocalMetadata(tools, capabilities);

  const registry = new ShellRegistry();
  registry.build(tools);

  await dispatch(args, registry, serverUrl, projectId);
}
