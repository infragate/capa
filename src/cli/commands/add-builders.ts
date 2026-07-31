/**
 * Builders that turn `capa add` CLI flags into capabilities-file entries.
 * Exported for unit tests.
 */

import { basename, resolve, relative, join } from 'path';
import { access } from 'fs/promises';
import { constants } from 'fs';
import { CANONICAL_HOOK_EVENTS, type CanonicalHookEvent, type Hook, type HookSource } from '../../types/hooks';
import type { Rule } from '../../types/rules';
import type { MCPServer, Tool } from '../../types/capabilities';

export function parseKeyValue(raw: string): { key: string; value: string } {
  const eq = raw.indexOf('=');
  if (eq <= 0) {
    throw new Error(`Expected KEY=VALUE, got: ${raw}`);
  }
  return { key: raw.slice(0, eq), value: raw.slice(eq + 1) };
}

export function parseKeyValueList(items: string[] | undefined): Record<string, string> | undefined {
  if (!items || items.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const item of items) {
    const { key, value } = parseKeyValue(item);
    out[key] = value;
  }
  return out;
}

export interface BuildServerOptions {
  id?: string;
  type?: string;
  cmd?: string;
  arg?: string[];
  env?: string[];
  url?: string;
  header?: string[];
  cwd?: string;
  description?: string;
}

export function buildServerEntry(opts: BuildServerOptions): Record<string, unknown> {
  const serverType = (opts.type ?? 'mcp').trim().toLowerCase();
  if (serverType !== 'mcp') {
    throw new Error(
      `Unsupported server type "${opts.type}". Only "mcp" is supported today.\n` +
        `  Example: capa add --server --type mcp --id my-server --url https://…`,
    );
  }
  const id = opts.id?.trim();
  if (!id) {
    throw new Error('Server requires --id <id>.');
  }

  const hasCmd = !!opts.cmd?.trim();
  const hasUrl = !!opts.url?.trim();
  if (hasCmd === hasUrl) {
    throw new Error('Server requires exactly one of --cmd or --url.');
  }

  const def: Record<string, unknown> = {};
  if (hasCmd) {
    def.cmd = opts.cmd!.trim();
    if (opts.arg && opts.arg.length > 0) def.args = opts.arg;
    const env = parseKeyValueList(opts.env);
    if (env) def.env = env;
    if (opts.cwd?.trim()) def.cwd = opts.cwd.trim();
  } else {
    def.url = opts.url!.trim();
    const headers = parseKeyValueList(opts.header);
    if (headers) def.headers = headers;
  }

  const entry: Record<string, unknown> = {
    id,
    type: 'mcp',
    def,
  };
  if (opts.description?.trim()) entry.description = opts.description.trim();
  return entry;
}

/** Narrow helper for typed tests / callers. */
export function buildServerEntryAsMcp(opts: BuildServerOptions): MCPServer {
  return buildServerEntry(opts) as unknown as MCPServer;
}

export interface BuildToolOptions {
  id?: string;
  mcpServer?: string;
  mcpTool?: string;
  default?: string[];
  command?: string;
  description?: string;
  group?: string;
}

export function buildToolEntry(opts: BuildToolOptions): Record<string, unknown> {
  const id = opts.id?.trim();
  if (!id) {
    throw new Error('Tool requires --id <id>.');
  }

  const hasMcp = !!(opts.mcpServer || opts.mcpTool);
  const hasCommand = !!opts.command?.trim();
  if (hasMcp && hasCommand) {
    throw new Error('Tool cannot combine --mcp-server/--mcp-tool with --command.');
  }
  if (!hasMcp && !hasCommand) {
    throw new Error('Tool requires either --mcp-server + --mcp-tool, or --command.');
  }

  if (hasCommand) {
    const entry: Record<string, unknown> = {
      id,
      type: 'command',
      def: { run: { cmd: opts.command!.trim() } },
    };
    if (opts.description?.trim()) entry.description = opts.description.trim();
    if (opts.group?.trim()) entry.group = opts.group.trim();
    return entry;
  }

  if (!opts.mcpServer?.trim() || !opts.mcpTool?.trim()) {
    throw new Error('MCP tool requires both --mcp-server <@id> and --mcp-tool <name>.');
  }
  let server = opts.mcpServer.trim();
  if (!server.startsWith('@')) server = `@${server}`;

  const def: Record<string, unknown> = {
    server,
    tool: opts.mcpTool.trim(),
  };
  const defaults = parseKeyValueList(opts.default);
  if (defaults) def.defaults = defaults;

  const entry: Record<string, unknown> = {
    id,
    type: 'mcp',
    def,
  };
  if (opts.description?.trim()) entry.description = opts.description.trim();
  if (opts.group?.trim()) entry.group = opts.group.trim();
  return entry;
}

export function buildToolEntryAsTool(opts: BuildToolOptions): Tool {
  return buildToolEntry(opts) as unknown as Tool;
}

export interface ParsedRuleSource {
  id: string;
  type: 'inline' | 'remote' | 'github' | 'gitlab' | 'local';
  content?: string;
  url?: string;
  path?: string;
  def?: { repo: string };
}

/**
 * Parse a rule source. Unlike skills, local paths point at a markdown *file*
 * (or any readable file), not a directory with SKILL.md.
 */
export async function parseRuleSource(source: string): Promise<ParsedRuleSource> {
  const githubExactMatch = source.match(
    /^([\w.-]+\/[\w.-]+)::([\w./-]+?)(?::([\w.-]+)|#([a-f0-9]{7,40}))?$/i,
  );
  if (githubExactMatch) {
    const [, repo, path, version, ref] = githubExactMatch;
    return {
      id: basename(path).replace(/\.md$/i, ''),
      type: 'github',
      def: {
        repo: `${repo}::${path}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`,
      },
    };
  }

  const githubAtMatch = source.match(
    /^([\w.-]+\/[\w.-]+)@([\w.-]+)(?::([\w.-]+)|#([a-f0-9]{7,40}))?$/i,
  );
  if (githubAtMatch) {
    const [, repo, name, version, ref] = githubAtMatch;
    return {
      id: name.replace(/\.md$/i, ''),
      type: 'github',
      def: {
        repo: `${repo}@${name}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`,
      },
    };
  }

  const gitlabExactMatch = source.match(
    /^gitlab:([\w.-]+(?:\/[\w.-]+)+)::([\w./-]+?)(?::([\w.-]+)|#([a-f0-9]{7,40}))?$/i,
  );
  if (gitlabExactMatch) {
    const [, repo, path, version, ref] = gitlabExactMatch;
    return {
      id: basename(path).replace(/\.md$/i, ''),
      type: 'gitlab',
      def: {
        repo: `${repo}::${path}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`,
      },
    };
  }

  const gitlabAtMatch = source.match(
    /^gitlab:([\w.-]+(?:\/[\w.-]+)+)@([\w.-]+)(?::([\w.-]+)|#([a-f0-9]{7,40}))?$/i,
  );
  if (gitlabAtMatch) {
    const [, repo, name, version, ref] = gitlabAtMatch;
    return {
      id: name.replace(/\.md$/i, ''),
      type: 'gitlab',
      def: {
        repo: `${repo}@${name}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`,
      },
    };
  }

  if (
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('/') ||
    /^[A-Za-z]:/.test(source)
  ) {
    const absPath = resolve(process.cwd(), source);
    try {
      await access(absPath, constants.R_OK);
    } catch {
      throw new Error(`Rule file not found or unreadable: ${absPath}`);
    }
    const projectRoot = process.cwd();
    const pathToStore = absPath.startsWith(projectRoot)
      ? relative(projectRoot, absPath)
      : absPath;
    return {
      id: basename(absPath).replace(/\.md$/i, ''),
      type: 'local',
      path: pathToStore,
    };
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    return {
      id: basename(source).replace(/\.md$/i, '') || 'custom-rule',
      type: 'remote',
      url: source,
    };
  }

  throw new Error(
    `Unable to parse rule source: ${source}\n\n` +
      `Supported formats:\n` +
      `  GitHub:  owner/repo@rule-name  or  owner/repo::path/to/rule.md\n` +
      `  GitLab:  gitlab:group/repo@rule-name\n` +
      `  Local:   ./path/to/rule.md\n` +
      `  Remote:  https://example.com/rule.md\n` +
      `  Inline:  capa add --rule --id my-rule --inline "…"`,
  );
}

export interface BuildRuleOptions {
  id?: string;
  source?: string;
  inline?: string;
  appliesTo?: string[];
  alwaysApply?: boolean;
  description?: string;
}

export async function buildRuleEntry(opts: BuildRuleOptions): Promise<Record<string, unknown>> {
  if (opts.inline !== undefined && opts.source) {
    throw new Error('Rule cannot combine --inline with a positional source.');
  }

  let parsed: ParsedRuleSource;
  if (opts.inline !== undefined) {
    const id = opts.id?.trim();
    if (!id) {
      throw new Error('Inline rule requires --id <id>.');
    }
    parsed = { id, type: 'inline', content: opts.inline };
  } else if (opts.source) {
    parsed = await parseRuleSource(opts.source);
    if (opts.id?.trim()) parsed.id = opts.id.trim();
  } else {
    throw new Error('Rule requires a positional <source> or --inline <content>.');
  }

  const entry: Record<string, unknown> = {
    id: parsed.id,
    type: parsed.type,
  };
  if (parsed.type === 'inline') entry.content = parsed.content ?? '';
  if (parsed.type === 'remote') entry.url = parsed.url;
  if (parsed.type === 'local') entry.path = parsed.path;
  if (parsed.type === 'github' || parsed.type === 'gitlab') entry.def = parsed.def;
  if (opts.appliesTo && opts.appliesTo.length > 0) entry.appliesTo = opts.appliesTo;
  if (opts.alwaysApply) entry.alwaysApply = true;
  if (opts.description?.trim()) entry.description = opts.description.trim();
  return entry;
}

export function buildRuleEntryAsRule(entry: Record<string, unknown>): Rule {
  return entry as unknown as Rule;
}

export interface BuildHookOptions {
  id?: string;
  on?: string;
  type?: string;
  command?: string;
  prompt?: string;
  source?: string;
  matcher?: string;
  timeout?: string | number;
  failClosed?: boolean;
  sequential?: boolean;
  description?: string;
}

function parseHookSource(raw: string): HookSource {
  const trimmed = raw.trim();
  if (
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('/') ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    const absPath = resolve(process.cwd(), trimmed);
    const projectRoot = process.cwd();
    const pathToStore = absPath.startsWith(projectRoot)
      ? relative(projectRoot, absPath)
      : absPath;
    return { type: 'local', path: pathToStore };
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return { type: 'remote', url: trimmed };
  }
  if (trimmed.toLowerCase().startsWith('gitlab:')) {
    return { type: 'gitlab', def: { repo: trimmed.replace(/^gitlab:/i, '') } };
  }
  // Treat owner/repo… as github
  if (/^[\w.-]+\/[\w.-]+/.test(trimmed)) {
    return { type: 'github', def: { repo: trimmed } };
  }
  throw new Error(
    `Unable to parse hook --source: ${raw}\n` +
      `  Use a local path, http(s) URL, github owner/repo…, or gitlab:group/repo…`,
  );
}

export function buildHookEntry(opts: BuildHookOptions): Record<string, unknown> {
  const id = opts.id?.trim();
  if (!id) {
    throw new Error('Hook requires --id <id>.');
  }
  const on = opts.on?.trim();
  if (!on) {
    throw new Error('Hook requires --on <event> (e.g. sessionStart, beforeShell, cursor:beforeShellExecution).');
  }

  const isCanonical = (CANONICAL_HOOK_EVENTS as readonly string[]).includes(on);
  const isProviderScoped = /^[a-zA-Z][\w-]*:.+/.test(on);
  if (!isCanonical && !isProviderScoped) {
    throw new Error(
      `Invalid hook event "${on}".\n` +
        `  Use a canonical event (${CANONICAL_HOOK_EVENTS.join(', ')})\n` +
        `  or a provider-scoped event like "cursor:beforeShellExecution".`,
    );
  }

  const hookType = (opts.type ?? 'command').trim().toLowerCase();
  if (hookType !== 'command' && hookType !== 'prompt') {
    throw new Error('Hook --type must be "command" or "prompt".');
  }

  const hasCommand = !!opts.command?.trim();
  const hasPrompt = !!opts.prompt?.trim();
  const hasSource = !!opts.source?.trim();

  if (hookType === 'command') {
    if (hasPrompt) throw new Error('Command hooks cannot use --prompt (use --command or --source).');
    if (!hasCommand && !hasSource) {
      throw new Error('Command hook requires --command <shell> or --source <path|url|repo>.');
    }
  } else {
    if (hasCommand) throw new Error('Prompt hooks cannot use --command (use --prompt or --source).');
    if (!hasPrompt && !hasSource) {
      throw new Error('Prompt hook requires --prompt <text> or --source <path|url|repo>.');
    }
  }

  const entry: Record<string, unknown> = {
    id,
    on: isCanonical ? (on as CanonicalHookEvent) : on,
    type: hookType,
  };
  if (hasCommand) entry.command = opts.command!.trim();
  if (hasPrompt) entry.prompt = opts.prompt!.trim();
  if (hasSource) entry.source = parseHookSource(opts.source!);
  if (opts.matcher?.trim()) entry.matcher = opts.matcher.trim();
  if (opts.description?.trim()) entry.description = opts.description.trim();
  if (opts.failClosed) entry.failClosed = true;
  if (opts.sequential) entry.sequential = true;
  if (opts.timeout !== undefined && opts.timeout !== '') {
    const n = typeof opts.timeout === 'number' ? opts.timeout : Number(opts.timeout);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid --timeout: ${opts.timeout}`);
    }
    entry.timeout = n;
  }
  return entry;
}

export function buildHookEntryAsHook(opts: BuildHookOptions): Hook {
  return buildHookEntry(opts) as unknown as Hook;
}

/** Kind flags that are mutually exclusive on `capa add`. */
export type AddKind = 'skill' | 'plugin' | 'server' | 'tool' | 'rule' | 'hook';

export function resolveAddKind(flags: {
  skill?: boolean;
  plugin?: boolean;
  server?: boolean;
  tool?: boolean;
  rule?: boolean;
  hook?: boolean;
}): AddKind {
  const kinds: AddKind[] = [];
  if (flags.skill) kinds.push('skill');
  if (flags.plugin) kinds.push('plugin');
  if (flags.server) kinds.push('server');
  if (flags.tool) kinds.push('tool');
  if (flags.rule) kinds.push('rule');
  if (flags.hook) kinds.push('hook');
  if (kinds.length > 1) {
    throw new Error(
      `Cannot combine kind flags: ${kinds.map((k) => `--${k}`).join(', ')}. Pass exactly one.`,
    );
  }
  return kinds[0] ?? 'skill';
}
