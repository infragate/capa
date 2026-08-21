import { createHash } from 'crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Capabilities, SecretValue } from '../types/capabilities';
import type { Hook } from '../types/hooks';
import type { Plugin } from '../types/plugin';
import { getCapaDir } from './config';
import { secretValueMapForFingerprint } from './secret-value';

export interface SurfaceServer {
  id: string;
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface SurfaceHook {
  id: string;
  command?: string;
  prompt?: string;
  source?: unknown;
}

export interface SurfaceFormatter {
  toolId: string;
  cmd: string;
  timeout?: number;
}

export interface SurfacePlugin {
  id: string;
  type: string;
  repo: string;
  version?: string;
  ref?: string;
  subpath?: string;
}

export interface SurfaceCommandTool {
  id: string;
  cmd: string;
}

/** Shell command used to resolve an MCP env/header secret at connect time. */
export interface SurfaceSecretCommand {
  serverId: string;
  kind: 'env' | 'headers';
  key: string;
  command: string;
}

export interface ExecutableSurface {
  servers: SurfaceServer[];
  hooks: SurfaceHook[];
  formatters: SurfaceFormatter[];
  plugins: SurfacePlugin[];
  commandTools: SurfaceCommandTool[];
  secretCommands: SurfaceSecretCommand[];
}

function sortedRecord(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
}

function collectFromCommandEntries(
  serverId: string,
  kind: 'env' | 'headers',
  record: Record<string, SecretValue> | undefined,
  out: SurfaceSecretCommand[],
): void {
  if (!record) return;
  for (const [key, value] of Object.entries(record)) {
    if (
      value &&
      typeof value === 'object' &&
      'fromCommand' in value &&
      typeof value.fromCommand === 'string' &&
      value.fromCommand.length > 0
    ) {
      out.push({ serverId, kind, key, command: value.fromCommand });
    }
  }
}

export function collectExecutableSurface(capabilities: Capabilities): ExecutableSurface {
  const servers: SurfaceServer[] = [];
  const secretCommands: SurfaceSecretCommand[] = [];
  for (const server of capabilities.servers ?? []) {
    collectFromCommandEntries(server.id, 'env', server.def?.env, secretCommands);
    collectFromCommandEntries(server.id, 'headers', server.def?.headers, secretCommands);

    const cmd = server.def?.cmd;
    if (!cmd) continue;
    const entry: SurfaceServer = {
      id: server.id,
      cmd,
      args: server.def.args ?? [],
    };
    if (server.def.cwd) entry.cwd = server.def.cwd;
    const env = sortedRecord(secretValueMapForFingerprint(server.def.env));
    if (env) entry.env = env;
    servers.push(entry);
  }
  servers.sort((a, b) => a.id.localeCompare(b.id));
  secretCommands.sort((a, b) => {
    const byServer = a.serverId.localeCompare(b.serverId);
    if (byServer !== 0) return byServer;
    const byKind = a.kind.localeCompare(b.kind);
    if (byKind !== 0) return byKind;
    return a.key.localeCompare(b.key);
  });

  const hooks: SurfaceHook[] = [];
  for (const hook of (capabilities.hooks ?? []) as Hook[]) {
    const entry: SurfaceHook = { id: hook.id };
    if (hook.command) entry.command = hook.command;
    if (hook.prompt) entry.prompt = hook.prompt;
    if (hook.source) entry.source = hook.source;
    hooks.push(entry);
  }
  hooks.sort((a, b) => a.id.localeCompare(b.id));

  const formatters: SurfaceFormatter[] = [];
  for (const tool of capabilities.tools ?? []) {
    if (tool.type !== 'mcp') continue;
    const formatter = (tool.def as { formatter?: { cmd?: string; timeout?: number } }).formatter;
    if (!formatter?.cmd) continue;
    const entry: SurfaceFormatter = { toolId: tool.id, cmd: formatter.cmd };
    if (formatter.timeout !== undefined) entry.timeout = formatter.timeout;
    formatters.push(entry);
  }
  formatters.sort((a, b) => a.toolId.localeCompare(b.toolId));

  const plugins: SurfacePlugin[] = [];
  for (const plugin of (capabilities.plugins ?? []) as Plugin[]) {
    const id = plugin.id ?? plugin.def.repo;
    const entry: SurfacePlugin = {
      id,
      type: plugin.type,
      repo: plugin.def.repo,
    };
    if (plugin.def.version) entry.version = plugin.def.version;
    if (plugin.def.ref) entry.ref = plugin.def.ref;
    if (plugin.def.subpath) entry.subpath = plugin.def.subpath;
    plugins.push(entry);
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id));

  const commandTools: SurfaceCommandTool[] = [];
  for (const tool of capabilities.tools ?? []) {
    if (tool.type !== 'command') continue;
    const run = (tool.def as { run?: { cmd?: string } }).run;
    if (!run?.cmd) continue;
    commandTools.push({ id: tool.id, cmd: run.cmd });
  }
  commandTools.sort((a, b) => a.id.localeCompare(b.id));

  return { servers, hooks, formatters, plugins, commandTools, secretCommands };
}

export function fingerprintExecutableSurface(surface: ExecutableSurface): string {
  return createHash('sha256').update(JSON.stringify(surface)).digest('hex');
}

export function formatExecutableSurface(surface: ExecutableSurface): string {
  const lines: string[] = [];
  const hasAnything =
    surface.servers.length > 0 ||
    surface.hooks.length > 0 ||
    surface.formatters.length > 0 ||
    surface.plugins.length > 0 ||
    surface.commandTools.length > 0 ||
    surface.secretCommands.length > 0;

  if (!hasAnything) {
    return '(no executable MCP servers, hooks, formatters, plugins, or secret commands)';
  }

  if (surface.servers.length > 0) {
    lines.push('MCP stdio servers:');
    for (const server of surface.servers) {
      const argv = [server.cmd, ...server.args].join(' ');
      lines.push(`  - ${server.id}: ${argv}`);
    }
  }
  if (surface.secretCommands.length > 0) {
    lines.push('MCP secret commands (fromCommand):');
    for (const entry of surface.secretCommands) {
      lines.push(`  - ${entry.serverId} ${entry.kind}.${entry.key}: ${entry.command}`);
    }
  }
  if (surface.hooks.length > 0) {
    lines.push('Hooks:');
    for (const hook of surface.hooks) {
      const body =
        hook.command ??
        hook.prompt ??
        (hook.source ? JSON.stringify(hook.source) : '(source)');
      lines.push(`  - ${hook.id}: ${body}`);
    }
  }
  if (surface.formatters.length > 0) {
    lines.push('Formatters:');
    for (const formatter of surface.formatters) {
      lines.push(`  - ${formatter.toolId}: ${formatter.cmd}`);
    }
  }
  if (surface.commandTools.length > 0) {
    lines.push('Command tools:');
    for (const tool of surface.commandTools) {
      lines.push(`  - ${tool.id}: ${tool.cmd}`);
    }
  }
  if (surface.plugins.length > 0) {
    lines.push('Plugins:');
    for (const plugin of surface.plugins) {
      lines.push(`  - ${plugin.id} (${plugin.type}): ${plugin.repo}`);
    }
  }
  return lines.join('\n');
}

function confirmFile(projectId: string): string {
  return join(getCapaDir(), 'install-confirm', `${projectId}.json`);
}

export function readConfirmedFingerprint(projectId: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(confirmFile(projectId), 'utf8')) as {
      fingerprint?: unknown;
    };
    return typeof parsed.fingerprint === 'string' ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

export function writeConfirmedFingerprint(projectId: string, fingerprint: string): void {
  const dir = join(getCapaDir(), 'install-confirm');
  mkdirSync(dir, { recursive: true });
  const path = confirmFile(projectId);
  writeFileSync(path, JSON.stringify({ fingerprint }), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms that don't support chmod
  }
}
