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
import { authCommand } from './commands/auth';
import { upgradeCommand } from './commands/upgrade';
import { shellCommand } from './commands/sh';
import { cacheInfoCommand, cacheCleanCommand } from './commands/cache';
import { registryListCommand, registryPathCommand } from './commands/registry';
import { checkForUpdates } from './utils/version-check';
import { VERSION } from '../version';
import { setFlags, ExitCode, error } from './ui';

// Check if running as server
if (process.argv[2] === '__server__') {
  // Import and start server
  import('../server/index.js').catch((error) => {
    console.error('Failed to start server:', error);
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
      .command('install')
      .description('Install skills and configure tools')
      .option('-e, --env [file]', 'Load variables from .env file (defaults to .env if no file specified)')
      .option('-p, --provider <id>', 'Install for a single provider (e.g. "cursor", "claude-code")')
      .option('--no-cache', 'Bypass the on-disk cache and lockfile; re-resolve every remote source')
      .action(async (options) => {
        // Commander inverts --no-* flags: `options.cache` is true by default and
        // false when --no-cache is passed. Convert to the explicit noCache flag.
        await installCommand({ envFile: options.env, provider: options.provider, noCache: options.cache === false });
      });

    program
      .command('add <source>')
      .description('Add a skill or plugin from various sources (GitHub, GitLab, registry, local path, or remote URL)')
      .option('--plugin', 'Treat <source> as a plugin (default is skill)')
      .option('--skill', 'Treat <source> as a skill (default; flag exists for explicitness)')
      .action(async (source: string, options) => {
        await addCommand(source, options);
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
      .description('Stop the capa server')
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
      .description('Print the registries directory path')
      .action(async () => {
        await registryPathCommand();
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
