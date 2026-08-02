import { detectCapabilitiesFile, generateProjectId } from '../../../shared/paths';
import { parseCapabilitiesFile } from '../../../shared/capabilities';
import { getServerStatus } from '../../utils/server-manager';
import { resolveProjectIdentityPath } from '../../utils/wrap/marker';
import { slugify } from '../../../shared/slug';
import { parseShellGlobalFlags, parseInlineArgs, resolveArgs } from './args';
import { ShellRegistry, applyLocalMetadata } from './registry';
import type { ShellCommand } from './registry';
import { fetchShellToolsWithConfigure, ensureSchema, executeToolViaMCP } from './fetch';
import { printAvailableCommands, printGroupHelp, printCommandHelp, buildArgList } from './help';

async function runPassthrough(tokens: string[]): Promise<void> {
  if (process.env.CAPA_NO_SHELL_WARN !== '1') {
    console.warn('capa: running OS shell passthrough. Set CAPA_NO_SHELL_WARN=1 to suppress.');
  }
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

async function execCommand(
  cmd: ShellCommand,
  rawArgTokens: string[],
  serverUrl: string,
  projectId: string,
  rawMode = false
): Promise<void> {
  const rawArgs = parseInlineArgs(rawArgTokens);
  const resolved = resolveArgs(cmd, rawArgs);

  if (cmd.defaults) {
    for (const [key, value] of Object.entries(cmd.defaults)) {
      if (!(key in resolved)) {
        resolved[key] = value;
      }
    }
  }

  const required: string[] = cmd.inputSchema?.required || [];
  const missingRequired = required.filter((r) => !(slugify(r) in rawArgs) && !(r in rawArgs) && !(r in (cmd.defaults || {})));
  if (missingRequired.length > 0) {
    const props = cmd.inputSchema?.properties || {};
    console.error(`Missing required parameter(s):\n`);
    for (const argName of missingRequired) {
      const schema = props[argName] as any;
      const slug = slugify(argName);
      const typeStr = schema?.type ? `<${schema.type}>` : '';
      console.error(`  --${slug} ${typeStr}`);
      if (schema?.description) {
        console.error(`      ${schema.description}`);
      }
      if (schema?.enum) {
        console.error(`      Allowed values: ${schema.enum.join(', ')}`);
      }
    }
    const argList = buildArgList(cmd);
    console.error(`\nUsage: capa sh ${cmd.slug}${argList ? ' ' + argList : ''}`);
    process.exit(1);
  }

  const result = await executeToolViaMCP(serverUrl, projectId, cmd.id, resolved, rawMode);
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

/**
 * Load a command's schema before help/execution, exiting with a clear message if
 * the remote server backing it is unreachable. Scoped to the single tool, so other
 * commands in the session are unaffected.
 */
async function loadSchemaOrExit(
  cmd: ShellCommand,
  serverUrl: string,
  projectId: string
): Promise<void> {
  try {
    await ensureSchema(cmd, serverUrl, projectId);
  } catch (err: any) {
    console.error(`Could not load "${cmd.slug}": ${err.message}`);
    process.exit(1);
  }
}

async function dispatch(
  tokens: string[],
  registry: ShellRegistry,
  serverUrl: string,
  projectId: string,
  rawMode = false
): Promise<void> {
  if (tokens.length === 0) {
    printAvailableCommands(registry);
    return;
  }

  const first = tokens[0];
  const rest = tokens.slice(1);

  if (isHelpFlag(first)) {
    printAvailableCommands(registry);
    return;
  }

  // Group command
  if (registry.groups.has(first)) {
    const group = registry.groups.get(first)!;

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
    await loadSchemaOrExit(cmd, serverUrl, projectId);

    if (subRest.length > 0 && isHelpFlag(subRest[0])) {
      printCommandHelp(cmd);
      return;
    }

    await execCommand(cmd, subRest, serverUrl, projectId, rawMode);
    return;
  }

  // Top-level capa command
  if (registry.topLevelCommands.has(first)) {
    const cmd = registry.topLevelCommands.get(first)!;
    await loadSchemaOrExit(cmd, serverUrl, projectId);

    if (rest.length > 0 && isHelpFlag(rest[0])) {
      printCommandHelp(cmd);
      return;
    }

    await execCommand(cmd, rest, serverUrl, projectId, rawMode);
    return;
  }

  // Unknown — pass through to OS shell (including any --help flags)
  await runPassthrough(tokens);
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
  let capabilities;
  try {
    capabilities = await parseCapabilitiesFile(capFile.path, capFile.format);
  } catch (err: any) {
    console.error(`Failed to parse capabilities: ${err.message}`);
    process.exit(1);
  }

  let identityPath: string;
  try {
    identityPath = await resolveProjectIdentityPath(cwd);
  } catch (err: any) {
    console.error(err.message || String(err));
    process.exit(1);
  }
  const projectId = generateProjectId(identityPath);

  let tools = await fetchShellToolsWithConfigure(serverUrl, projectId, identityPath, capabilities).catch((err: any) => {
    console.error(`Failed to load tools: ${err.message}`);
    console.error('Make sure the project has been installed ("capa install").');
    process.exit(1);
  });

  tools = applyLocalMetadata(tools, capabilities);

  const registry = new ShellRegistry();
  registry.build(tools);

  const { rawMode, tokens } = parseShellGlobalFlags(args);

  await dispatch(tokens, registry, serverUrl, projectId, rawMode);
}
