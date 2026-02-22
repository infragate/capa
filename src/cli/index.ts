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
import { checkForUpdates } from './utils/version-check';
import { VERSION } from '../version';

// Check if running as server
if (process.argv[2] === '__server__') {
  // Import and start server
  import('../server/index.js').catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
} else {
  (async () => {
    // Start version check in the background while the command runs
    const isUpgradeCommand = process.argv[2] === 'upgrade';
    const updateCheckPromise = isUpgradeCommand ? Promise.resolve(null) : checkForUpdates();

    const program = new Command();

    program
      .name('capa')
      .description('An agentic skills and tools package manager')
      .version(VERSION);

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
      .action(async (options) => {
        await installCommand(options.env);
      });

    program
      .command('add <source>')
      .description('Add a skill from various sources (GitHub, GitLab, Git URL, local path)')
      .option('-i, --id <id>', 'Custom skill ID (defaults to auto-generated from source)')
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

    await program.parseAsync();

    // Show update notice after the command completes (if a newer version is available)
    const updateInfo = await updateCheckPromise;
    if (updateInfo?.hasUpdate) {
      console.log(`\n  A new version of capa is available: ${updateInfo.latestVersion} (current: ${updateInfo.currentVersion})`);
      console.log('  Run "capa upgrade" to update.\n');
    }
  })();
}
