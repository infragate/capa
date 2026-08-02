#!/usr/bin/env bun
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { restartCommand } from './commands/restart';
import { statusCommand } from './commands/status';
import { installCommand } from './commands/install';
import { cleanCommand } from './commands/clean';
import { addCommand } from './commands/add';
import { wrapCommand } from './commands/wrap';
import { authCommand } from './commands/auth';
import { upgradeCommand } from './commands/upgrade';
import { shellCommand } from './commands/sh';
import { activityIngestCommand } from './commands/activity-ingest';
import { cacheInfoCommand, cacheCleanCommand } from './commands/cache';
import {
  registryListCommand,
  registryPathCommand,
  registryAddCommand,
  registryRemoveCommand,
  registryRefreshCommand,
  registrySetEnabledCommand,
  registrySearchCommand,
} from './commands/registry';
import type { RegistrySourceType } from '../types/database';
import type { RegistryCapability } from '../types/registry';
import { checkForUpdates } from './utils/version-check';
import { VERSION } from '../version';
import { setFlags, ExitCode, error } from './ui';

/** Commander accumulator for repeatable options. */
function collectRepeatable(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

// Check if running as server
if (process.argv[2] === '__server__') {
  // Import and start server
  import('../server/index.js').catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
} else if (process.argv[2] === '__wrap_watch__') {
  import('./utils/wrap/watch-worker')
    .then(({ runWrapWatchWorker }) => runWrapWatchWorker(process.argv.slice(3)))
    .catch((err) => {
      console.error('Failed to start wrap watcher:', err);
      process.exit(1);
    });
} else {
  (async () => {
    try {
    // Start version check in the background while the command runs
    const isUpgradeCommand = process.argv[2] === 'upgrade';
    const updateCheckPromise = isUpgradeCommand ? Promise.resolve(null) : checkForUpdates();

    const program = new Command();

    program
      .name('capa')
      .description('An agentic skills and tools package manager')
      .version(VERSION)
      .option('--json', 'Machine-readable output')
      .option('-q, --quiet', 'Suppress non-essential output')
      .option('-v, --verbose', 'Verbose output')
      .option('--no-color', 'Disable colored output')
      .option('-y, --yes', 'Auto-accept all confirms');

    program.hook('preAction', () => {
      const opts = program.opts();
      setFlags({
        json: Boolean(opts.json),
        quiet: Boolean(opts.quiet),
        verbose: Boolean(opts.verbose),
        noColor: !opts.color,
        yes: Boolean(opts.yes),
      });
    });

    program
      .command('init')
      .description('Initialize a new capabilities file')
      .option('-f, --format <format>', 'File format (json or yaml)', 'yaml')
      .action(async (options) => {
        const format = options.format === 'json' ? 'json' : 'yaml';
        await initCommand(format);
      });

    program
      .command('add [source]')
      .description(
        'Add a skill, plugin, server, tool, rule, or hook (writes capabilities file, or native files with --passthrough)',
      )
      .option('--plugin', 'Treat as a plugin')
      .option('--skill', 'Treat as a skill (default when no other kind flag is set)')
      .option('--server', 'Add an MCP (or future) server entry')
      .option('--tool', 'Add a tool entry')
      .option('--rule', 'Add a rule entry')
      .option('--hook', 'Add a hook entry')
      .option('--passthrough', 'Write provider-native files; skip capabilities file and capa management')
      .option('--install', 'Also run capa install after updating the capabilities file')
      .option('-e, --env [file]', 'Load variables from .env file (defaults to .env if no file specified)')
      .option('-p, --provider <id>', 'Provider id (install follow-up, or required for --passthrough in non-TTY)')
      .option('--no-cache', 'Bypass the on-disk cache and lockfile; re-resolve every remote source')
      // Shared / server / tool / rule / hook metadata
      .option('--id <id>', 'Entry id (required for --server/--tool/--hook; optional override for --rule)')
      .option('--type <name>', 'Server type (default mcp) or hook type (command|prompt)')
      .option('--cmd <bin>', 'Server stdio command')
      .option('--arg <token>', 'Server stdio arg (repeatable)', collectRepeatable, [])
      .option('--env-var <KEY=VAL>', 'Server env var (repeatable)', collectRepeatable, [])
      .option('--url <url>', 'Remote MCP server URL')
      .option('--header <KEY=VAL>', 'Remote MCP header (repeatable)', collectRepeatable, [])
      .option('--cwd <path>', 'Server working directory')
      .option('--description <text>', 'Optional description')
      .option('--mcp-server <id>', 'Tool: MCP server reference (@id or id)')
      .option('--mcp-tool <name>', 'Tool: upstream MCP tool name')
      .option('--default <KEY=VAL>', 'Tool default arg (repeatable)', collectRepeatable, [])
      .option('--command <cmd>', 'Tool command body, or hook shell command')
      .option('--group <name>', 'Tool group name')
      .option('--inline <text>', 'Rule inline content')
      .option('--applies-to <glob>', 'Rule appliesTo glob (repeatable)', collectRepeatable, [])
      .option('--always-apply', 'Rule alwaysApply')
      .option('--on <event>', 'Hook event (sessionStart, beforeShell, …)')
      .option('--prompt <text>', 'Hook prompt body')
      .option('--source <path>', 'Hook alternate body source (path, URL, or repo)')
      .option('--matcher <pattern>', 'Hook matcher/pattern')
      .option('--timeout <seconds>', 'Hook timeout in seconds')
      .option('--fail-closed', 'Hook failClosed')
      .option('--sequential', 'Hook sequential')
      .action(async (source: string | undefined, options) => {
        await addCommand(source, {
          plugin: options.plugin,
          skill: options.skill,
          server: options.server,
          tool: options.tool,
          rule: options.rule,
          hook: options.hook,
          passthrough: options.passthrough === true,
          envFile: options.env,
          provider: options.provider,
          noCache: options.cache === false,
          install: options.install === true,
          id: options.id,
          type: options.type,
          cmd: options.cmd,
          arg: options.arg,
          // Commander --env is already used for .env file; server env uses --env-var
          env: options.envVar,
          url: options.url,
          header: options.header,
          cwd: options.cwd,
          description: options.description,
          mcpServer: options.mcpServer,
          mcpTool: options.mcpTool,
          default: options.default,
          command: options.command,
          group: options.group,
          inline: options.inline,
          appliesTo: options.appliesTo,
          alwaysApply: options.alwaysApply === true,
          on: options.on,
          prompt: options.prompt,
          source: options.source,
          matcher: options.matcher,
          timeout: options.timeout,
          failClosed: options.failClosed === true,
          sequential: options.sequential === true,
        });
      });

    program
      .command('install')
      .description('Install skills and configure tools')
      .option('-e, --env [file]', 'Load variables from .env file (defaults to .env if no file specified)')
      .option('-p, --provider <id>', 'Install for a single provider (e.g. "cursor", "claude-code")')
      .option('--no-cache', 'Bypass the on-disk cache and lockfile; re-resolve every remote source')
      .option('--passthrough', 'Write provider-native files from the capabilities file (no capa server/proxy)')
      .action(async (options) => {
        // Commander inverts --no-* flags: `options.cache` is true by default and
        // false when --no-cache is passed. Convert to the explicit noCache flag.
        await installCommand({
          envFile: options.env,
          provider: options.provider,
          noCache: options.cache === false,
          passthrough: options.passthrough === true,
        });
      });

    program
      .command('wrap [provider] [args...]')
      .description(
        'Run a provider from a CAPA shadow workspace without modifying in-repo provider configs (prompts for provider when omitted)',
      )
      .option('--project <dir>', 'Source project directory (default: cwd)')
      .option('--print-dir', 'Print the workspace path before launching')
      .option('--prune', 'Remove wrap workspaces under ~/.capa/workspaces and exit')
      .allowUnknownOption()
      .action(async (provider: string | undefined, args: string[], options) => {
        await wrapCommand(provider, args ?? [], {
          project: options.project,
          printDir: options.printDir === true,
          prune: options.prune === true,
        });
      });

    program
      .command('clean')
      .description('Remove managed files')
      .action(async () => {
        await cleanCommand();
      });

    program
      .command('start')
      .description('Start the capa server')
      .option('-f, --foreground', 'Run in foreground (for debugging)')
      .action(async (options) => {
        await startCommand(options.foreground);
      });

    program
      .command('stop')
      .description('Stop the capa server and any active wrap sessions')
      .action(async () => {
        await stopCommand();
      });

    program
      .command('restart')
      .description('Restart the capa server')
      .action(async () => {
        await restartCommand();
      });

    program
      .command('status')
      .description('Check the health status of the capa server')
      .action(async () => {
        await statusCommand();
      });

    program
      .command('auth [provider]')
      .description('Authenticate with Git providers (github.com, gitlab.com, etc.)')
      .action(async (provider?: string) => {
        await authCommand(provider);
      });

    program
      .command('upgrade')
      .description('Upgrade capa to the latest version')
      .action(async () => {
        await upgradeCommand();
      });

    program
      .command('sh [args...]')
      .description('Run capa tools as CLI commands, or pass through to the OS shell')
      .helpOption(false)      // let capa sh handle --help itself
      .allowUnknownOption()   // pass unknown options (--query, etc.) into args
      .action(async (args: string[]) => {
        await shellCommand(args);
      });

    program
      .command('activity-ingest')
      .description('Internal: ingest provider hook activity into the project Activity feed (fail-open)')
      .option('-p, --project <id>', 'Project id')
      .option('-e, --event <name>', 'Canonical hook event name')
      .option('--provider <id>', 'Provider id to stamp on the activity source')
      .allowUnknownOption()
      .action(async (options) => {
        const args: string[] = [];
        if (options.project) {
          args.push('--project', String(options.project));
        }
        if (options.event) {
          args.push('--event', String(options.event));
        }
        if (options.provider) {
          args.push('--provider', String(options.provider));
        }
        await activityIngestCommand(args);
      });

    const cacheCmd = program
      .command('cache')
      .description('Inspect or manage the on-disk cache for remote sources')
      .action(async () => {
        await cacheInfoCommand();
      });

    cacheCmd
      .command('clean')
      .description('Remove all cached repositories and snapshots')
      .action(async () => {
        await cacheCleanCommand();
      });

    const registryCmd = program
      .command('registry')
      .description('Manage third-party registries for browsing skills and plugins')
      .action(async () => {
        await registryListCommand();
      });

    registryCmd
      .command('list')
      .description('List all configured registries and their capabilities')
      .action(async () => {
        await registryListCommand();
      });

    registryCmd
      .command('path')
      .description('Print the managed registries directory path')
      .action(async () => {
        await registryPathCommand();
      });

    registryCmd
      .command('add <source> [slug]')
      .description('Fetch a registry adapter from a git repo or HTTPS URL and install it')
      .option(
        '--type <type>',
        'Source type: github, gitlab, url, or claude-marketplace (auto-detected from source by default)',
      )
      .option('--no-cache', 'Bypass the on-disk repo cache when fetching')
      .action(async (source: string, slug: string | undefined, opts: { type?: string; cache?: boolean }) => {
        let type: RegistrySourceType | undefined;
        if (opts.type) {
          if (
            opts.type !== 'github' &&
            opts.type !== 'gitlab' &&
            opts.type !== 'url' &&
            opts.type !== 'claude-marketplace'
          ) {
            error(
              `Invalid --type "${opts.type}". Expected one of: github, gitlab, url, claude-marketplace.`,
            );
            process.exit(ExitCode.USER_ERROR);
          }
          type = opts.type;
        }
        await registryAddCommand(source, slug, { type, noCache: opts.cache === false });
      });

    registryCmd
      .command('remove <slug>')
      .description('Remove a configured registry and its materialized adapter file')
      .action(async (slug: string) => {
        await registryRemoveCommand(slug);
      });

    registryCmd
      .command('refresh <slug>')
      .description('Re-fetch a registry from its original source')
      .option('--no-cache', 'Bypass the on-disk repo cache when refreshing')
      .action(async (slug: string, opts: { cache?: boolean }) => {
        await registryRefreshCommand(slug, { noCache: opts.cache === false });
      });

    registryCmd
      .command('search [slug] [query]')
      .description('Search registries for skills and plugins (omit slug to search all enabled registries)')
      .option('-q, --query <query>', 'Search query (alternative to positional)')
      .option('-c, --capability <capability>', 'Restrict to one capability: skills or plugins')
      .option('-l, --limit <n>', 'Max results per registry', (v) => Number.parseInt(v, 10))
      .action(async (
        slugArg: string | undefined,
        queryArg: string | undefined,
        opts: { query?: string; capability?: string; limit?: number },
      ) => {
        // Accept either positional form: `search <slug> <query>` or `search <query>`.
        // The --query flag, if provided, always wins.
        let slug: string | undefined;
        let query: string | undefined = opts.query;
        if (!query) {
          if (queryArg !== undefined) {
            slug = slugArg;
            query = queryArg;
          } else {
            query = slugArg;
          }
        } else {
          slug = slugArg ?? queryArg;
        }

        if (!query) {
          error('A search query is required. Usage: capa registry search [slug] <query>');
          process.exit(ExitCode.USER_ERROR);
        }

        let capability: RegistryCapability | undefined;
        if (opts.capability) {
          if (opts.capability !== 'skills' && opts.capability !== 'plugins') {
            error(`Invalid --capability "${opts.capability}". Expected one of: skills, plugins.`);
            process.exit(ExitCode.USER_ERROR);
          }
          capability = opts.capability;
        }

        await registrySearchCommand(query, { slug, capability, limit: opts.limit });
      });

    registryCmd
      .command('enable <slug>')
      .description('Enable a previously-disabled registry')
      .action(async (slug: string) => {
        await registrySetEnabledCommand(slug, true);
      });

    registryCmd
      .command('disable <slug>')
      .description('Disable a registry without removing it')
      .action(async (slug: string) => {
        await registrySetEnabledCommand(slug, false);
      });

    await program.parseAsync();

    // Show update notice after the command completes (if a newer version is available)
    const updateInfo = await updateCheckPromise;
    if (updateInfo?.hasUpdate) {
      console.log(`\n  A new version of capa is available: ${updateInfo.latestVersion} (current: ${updateInfo.currentVersion})`);
      console.log('  Run "capa upgrade" to update.\n');
    }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      error(message);
      process.exit(ExitCode.SYSTEM_ERROR);
    }
  })();
}
