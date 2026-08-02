import { detectCapabilitiesFile } from '../../shared/paths';
import { parseCapabilitiesFile, appendCapabilityEntry } from '../../shared/capabilities';
import { installCommand } from './install';
import type { Skill, Capabilities } from '../../types/capabilities';
import type { Plugin } from '../../types/plugin';
import type { CapabilitiesFormat } from '../../types/capabilities';
import { refuseIfWrapWorkspace } from '../utils/wrap/marker';
import {
  buildServerEntry,
  buildToolEntry,
  buildRuleEntry,
  buildHookEntry,
  resolveAddKind,
  type AddKind,
} from './add-builders';
import { tryResolveRegistryItem } from './resolve-registry-source';
import { parseSkillSource, type ParsedSkillSource } from './add-parse-skill';
import { parsePluginSource, type ParsedPluginSource } from './add-parse-plugin';

export { parseSkillSource, type ParsedSkillSource } from './add-parse-skill';
export { parsePluginSource, type ParsedPluginSource } from './add-parse-plugin';

export interface AddCommandOptions {
  plugin?: boolean;
  skill?: boolean;
  server?: boolean;
  tool?: boolean;
  rule?: boolean;
  hook?: boolean;
  provider?: string;
  envFile?: string | boolean;
  noCache?: boolean;
  /** When true, run install after updating the capabilities file (legacy one-shot). */
  install?: boolean;
  /** Write provider-native files; skip capabilities file / capa server / DB tracking. */
  passthrough?: boolean;
  // Server flags
  id?: string;
  type?: string;
  cmd?: string;
  arg?: string[];
  env?: string[];
  url?: string;
  header?: string[];
  cwd?: string;
  description?: string;
  // Tool flags
  mcpServer?: string;
  mcpTool?: string;
  default?: string[];
  command?: string;
  group?: string;
  // Rule flags
  inline?: string;
  appliesTo?: string[];
  alwaysApply?: boolean;
  // Hook flags
  on?: string;
  prompt?: string;
  source?: string;
  matcher?: string;
  timeout?: string;
  failClosed?: boolean;
  sequential?: boolean;
}

export async function addCommand(
  source: string | undefined,
  options: AddCommandOptions
): Promise<void> {
  if (await refuseIfWrapWorkspace('add')) {
    process.exit(1);
  }

  let kind: AddKind;
  try {
    kind = resolveAddKind(options);
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (options.passthrough && options.install) {
    console.log('Note: --install is ignored with --passthrough (files are written immediately).\n');
  }

  if (options.passthrough) {
    const { passthroughAdd } = await import('../utils/passthrough');
    await passthroughAdd(source, kind, options);
    return;
  }

  const installOpts = {
    envFile: options.envFile,
    provider: options.provider,
    noCache: options.noCache,
  };
  const shouldInstall = options.install === true;

  async function maybeInstall(): Promise<void> {
    if (shouldInstall) {
      console.log('\n📦 Running installation...\n');
      await installCommand(installOpts);
      return;
    }
    console.log(
      '\nCapabilities file updated. Run capa install.\n',
    );
  }

  const projectPath = process.cwd();

  const capabilitiesFile = await detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    console.error('✗ No capabilities file found. Run "capa init" first.');
    process.exit(1);
  }

  console.log(`Using ${capabilitiesFile.path}`);

  const capabilities = await parseCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format
  );

  // --- Server / tool / rule / hook (no registry route) ---
  if (kind === 'server' || kind === 'tool' || kind === 'rule' || kind === 'hook') {
    try {
      await appendTypedEntry(kind, source, options, capabilities, capabilitiesFile, maybeInstall);
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }

  if (!source) {
    console.error('✗ Missing <source>. Example: capa add owner/repo@skill-name');
    process.exit(1);
  }

  // --- Registry route (runs before --plugin / --skill branches) ---
  {
    let resolved;
    try {
      resolved = source ? await tryResolveRegistryItem(source) : null;
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    if (resolved) {
      console.log(`Resolving from registry "${resolved.registryName}"...`);

      if (options.plugin && resolved.capability !== 'plugins') {
        console.warn(
          `  ⚠ --plugin ignored: registry "${resolved.registryId}" resolved "${resolved.itemId}" as a ${resolved.capability.slice(0, -1)}.`,
        );
      }
      if (options.skill && resolved.capability !== 'skills') {
        console.warn(
          `  ⚠ --skill ignored: registry "${resolved.registryId}" resolved "${resolved.itemId}" as a ${resolved.capability.slice(0, -1)}.`,
        );
      }

      if (resolved.capability === 'skills' && resolved.skill) {
        const existing = capabilities.skills.find((s) => s.id === resolved.itemName);
        if (existing) {
          console.error(`\u2717 Skill with id "${resolved.itemName}" already exists in capabilities file.`);
          console.error(`  Rename or remove the existing entry in ${capabilitiesFile.path} and try again.`);
          process.exit(1);
        }
        await appendCapabilityEntry(
          capabilitiesFile.path,
          capabilitiesFile.format,
          'skills',
          resolved.skill as unknown as Record<string, unknown>,
        );
      } else if (resolved.capability === 'plugins' && resolved.plugin) {
        if (!capabilities.plugins) capabilities.plugins = [];
        const newPlugin = resolved.plugin;
        const existing = capabilities.plugins.find(
          (p) =>
            (p as { id?: string }).id === resolved.itemName ||
            (p.type === newPlugin.type &&
              p.def.repo === newPlugin.def.repo &&
              (p.def.subpath ?? '') === (newPlugin.def.subpath ?? '')),
        );
        if (existing) {
          console.error(`\u2717 Plugin "${resolved.itemName}" already exists in capabilities file.`);
          console.error(`  Rename or remove the existing entry in ${capabilitiesFile.path} and try again.`);
          process.exit(1);
        }
        await appendCapabilityEntry(
          capabilitiesFile.path,
          capabilitiesFile.format,
          'plugins',
          { ...newPlugin, id: resolved.itemName } as unknown as Record<string, unknown>,
        );
      }

      console.log(
        `\u2713 Added ${resolved.capability.slice(0, -1)} "${resolved.itemName}" from registry "${resolved.registryId}" to ${capabilitiesFile.path}`,
      );
      await maybeInstall();
      return;
    }
  }

  // --- Plugin mode (--plugin flag) ---
  if (kind === 'plugin') {
    let parsed: ParsedPluginSource;
    try {
      parsed = parsePluginSource(source);
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }

    const id = parsed.idHint;
    if (!capabilities.plugins) capabilities.plugins = [];
    const dup = capabilities.plugins.find(p =>
      p.id === id ||
      (p.type === parsed.type
        && p.def.repo === parsed.def.repo
        && (p.def.subpath ?? '') === (parsed.def.subpath ?? '')));
    if (dup) {
      console.error(`✗ Plugin "${id}" already exists in capabilities file.`);
      console.error(`  Rename or remove the existing entry in ${capabilitiesFile.path} and try again.`);
      process.exit(1);
    }

    await appendCapabilityEntry(
      capabilitiesFile.path,
      capabilitiesFile.format,
      'plugins',
      { id, type: parsed.type, def: parsed.def } as unknown as Record<string, unknown>
    );

    console.log(`✓ Added plugin "${id}" to ${capabilitiesFile.path}`);
    console.log(`  Type: ${parsed.type}`);
    console.log(`  Repo: ${parsed.def.repo}`);
    if (parsed.def.version) console.log(`  Version: ${parsed.def.version}`);
    if (parsed.def.ref) console.log(`  Ref: ${parsed.def.ref}`);

    await maybeInstall();
    return;
  }

  // --- Skill mode (default, or --skill flag) ---
  let skillDef: ParsedSkillSource;
  try {
    skillDef = await parseSkillSource(source);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const existingSkill = capabilities.skills.find(s => s.id === skillDef.id);
  if (existingSkill) {
    console.error(`✗ Skill with id "${skillDef.id}" already exists in capabilities file.`);
    console.error(`  Rename or remove the existing entry in ${capabilitiesFile.path} and try again.`);
    process.exit(1);
  }

  const newSkill: Skill = {
    id: skillDef.id,
    type: skillDef.type,
    def: skillDef.def
  };

  await appendCapabilityEntry(
    capabilitiesFile.path,
    capabilitiesFile.format,
    'skills',
    newSkill as unknown as Record<string, unknown>
  );

  console.log(`✓ Added skill "${skillDef.id}" to ${capabilitiesFile.path}`);
  console.log(`  Type: ${skillDef.type}`);
  if (skillDef.def.repo) {
    console.log(`  Repo: ${skillDef.def.repo}`);
  } else if (skillDef.def.url) {
    console.log(`  URL: ${skillDef.def.url}`);
  } else if (skillDef.def.path) {
    console.log(`  Path: ${skillDef.def.path}`);
  }

  await maybeInstall();
}

async function appendTypedEntry(
  kind: 'server' | 'tool' | 'rule' | 'hook',
  source: string | undefined,
  options: AddCommandOptions,
  capabilities: Capabilities,
  capabilitiesFile: { path: string; format: CapabilitiesFormat },
  maybeInstall: () => Promise<void>,
): Promise<void> {
  let entry: Record<string, unknown>;
  let section: 'servers' | 'tools' | 'rules' | 'hooks';
  let label: string;

  if (kind === 'server') {
    if (source) {
      throw new Error('Server mode does not take a positional <source>; use --id/--cmd/--url flags.');
    }
    entry = buildServerEntry({
      id: options.id,
      type: options.type,
      cmd: options.cmd,
      arg: options.arg,
      env: options.env,
      url: options.url,
      header: options.header,
      cwd: options.cwd,
      description: options.description,
    });
    section = 'servers';
    label = 'server';
    const existing = (capabilities.servers ?? []).find((s) => s.id === entry.id);
    if (existing) {
      throw new Error(`Server with id "${entry.id}" already exists in capabilities file.`);
    }
  } else if (kind === 'tool') {
    if (source) {
      throw new Error('Tool mode does not take a positional <source>; use --id and MCP/command flags.');
    }
    entry = buildToolEntry({
      id: options.id,
      mcpServer: options.mcpServer,
      mcpTool: options.mcpTool,
      default: options.default,
      command: options.command,
      description: options.description,
      group: options.group,
    });
    section = 'tools';
    label = 'tool';
    const existing = (capabilities.tools ?? []).find((t) => t.id === entry.id);
    if (existing) {
      throw new Error(`Tool with id "${entry.id}" already exists in capabilities file.`);
    }
  } else if (kind === 'rule') {
    entry = await buildRuleEntry({
      id: options.id,
      source,
      inline: options.inline,
      appliesTo: options.appliesTo,
      alwaysApply: options.alwaysApply,
      description: options.description,
    });
    section = 'rules';
    label = 'rule';
    const existing = (capabilities.rules ?? []).find((r) => r.id === entry.id);
    if (existing) {
      throw new Error(`Rule with id "${entry.id}" already exists in capabilities file.`);
    }
  } else {
    if (source) {
      throw new Error('Hook mode does not take a positional <source>; use --id/--on/--command flags.');
    }
    entry = buildHookEntry({
      id: options.id,
      on: options.on,
      type: options.type,
      command: options.command,
      prompt: options.prompt,
      source: options.source,
      matcher: options.matcher,
      timeout: options.timeout,
      failClosed: options.failClosed,
      sequential: options.sequential,
      description: options.description,
    });
    section = 'hooks';
    label = 'hook';
    const existing = (capabilities.hooks ?? []).find((h) => h.id === entry.id);
    if (existing) {
      throw new Error(`Hook with id "${entry.id}" already exists in capabilities file.`);
    }
  }

  await appendCapabilityEntry(
    capabilitiesFile.path,
    capabilitiesFile.format,
    section,
    entry,
  );

  console.log(`✓ Added ${label} "${entry.id}" to ${capabilitiesFile.path}`);
  await maybeInstall();
}

