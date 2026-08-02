import { slugify } from '../../../shared/slug';
import type { ShellCommand, ShellGroup, ShellRegistry } from './registry';

function groupDescription(group: ShellGroup): string {
  if (group.description) return group.description;
  const n = group.commands.size;
  return `${n} subcommand${n === 1 ? '' : 's'} available`;
}

export function printAvailableCommands(registry: ShellRegistry): void {
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
      const desc = cmd.description || '';
      console.log(`  ${slug}${padding}${desc}`);
    }
  }

  console.log('\nUsage:');
  console.log('  capa sh                              Show this help');
  console.log('  capa sh <group>                      List tools in a group');
  console.log('  capa sh <group> <tool> [--arg val]   Run a tool');
  console.log('  capa sh <command> [--arg val]        Run a top-level command');
  console.log('  capa sh --raw <command> [--arg val]  Return raw tool output (skip formatter)');
  console.log('  capa sh <other>                      Pass through to OS shell\n');
}

export function printGroupHelp(group: ShellGroup): void {
  if (group.commands.size === 0) {
    console.log(`  ${group.slug} has no available subcommands.`);
    return;
  }
  console.log(`\n${group.slug} - subcommands:\n`);
  const colWidth = 24;
  for (const [slug, cmd] of group.commands) {
    const desc = cmd.description || '';
    const padding = ' '.repeat(Math.max(1, colWidth - slug.length));
    console.log(`  ${slug}${padding}${desc}`);
  }
  console.log(`\nUsage: capa sh ${group.slug} <subcommand> [--arg val]`);
  console.log(`       capa sh ${group.slug} <subcommand> --help   Show parameter details\n`);
}

export function printCommandHelp(cmd: ShellCommand): void {
  console.log('');
  if (cmd.description) {
    console.log(`  ${cmd.slug}  —  ${cmd.description}`);
  } else {
    console.log(`  ${cmd.slug}`);
  }
  const props = cmd.inputSchema?.properties || {};
  const required: string[] = cmd.inputSchema?.required || [];
  if (Object.keys(props).length > 0) {
    console.log('\n  Parameters:\n');
    for (const [argName, schema] of Object.entries(props) as [string, any][]) {
      const slug = slugify(argName);
      const isRequired = required.includes(argName);
      const typeStr = schema.type ? `<${schema.type}>` : '';
      const reqStr = isRequired ? ' (required)' : ' (optional)';
      console.log(`    --${slug} ${typeStr}${reqStr}`);
      if (schema.description) {
        console.log(`        ${schema.description}`);
      }
      if (schema.enum) {
        console.log(`        Allowed values: ${schema.enum.join(', ')}`);
      }
      if (schema.default !== undefined) {
        console.log(`        Default: ${schema.default}`);
      }
    }
  } else {
    console.log('\n  This command takes no parameters.');
  }
  console.log('');
}

export function buildArgList(cmd: ShellCommand): string {
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
