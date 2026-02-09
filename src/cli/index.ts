#!/usr/bin/env bun
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { restartCommand } from './commands/restart';
import { installCommand } from './commands/install';
import { cleanCommand } from './commands/clean';
import { addCommand } from './commands/add';
import { VERSION } from '../version';

// Check if running as server
if (process.argv[2] === '__server__') {
  // Import and start server
  import('../server/index.js').catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
} else {
  // Run CLI
  const program = new Command();

program
  .name('capa')
  .description('An agentic skills and tools package manager')
  .version(VERSION);

program
  .command('init')
  .description('Initialize a new capabilities file')
  .option('-f, --format <format>', 'File format (json or yaml)', 'json')
  .action(async (options) => {
    const format = options.format === 'json' ? 'json' : 'yaml';
    await initCommand(format);
  });

program
  .command('install')
  .description('Install skills and configure tools')
  .action(async () => {
    await installCommand();
  });

program
  .command('add <source>')
  .description('Add a skill from various sources (GitHub, GitLab, Git URL, local path)')
  .option('--id <id>', 'Custom skill ID (defaults to auto-generated from source)')
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

program.parse();
}
