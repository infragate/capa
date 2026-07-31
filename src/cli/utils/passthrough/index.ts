/**
 * Passthrough mode: resolve capa sources and write provider-native files
 * without a capa server, proxy MCP entry, or managed DB tracking.
 */

import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { resolveProviders } from '../../../shared/providers/resolve';
import { loadSettings, getDatabasePath } from '../../../shared/config';
import { CapaDatabase } from '../../../db/database';
import { createAuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { LockfileBuilder } from '../../../shared/lockfile';
import { generateProjectId } from '../../../shared/paths';
import { getRepoSnapshot } from '../../commands/install-tasks/helpers/repo-snapshot';
import { installOneSkill } from '../../commands/install-tasks/helpers/install-one-skill';
import { resolveRuleBody } from '../../commands/install-tasks/install-rules';
import { installRules } from '../rules-installer';
import { installHooks } from '../hooks-installer';
import { resolvePlugins } from '../../commands/plugin-install';
import { parseSkillSource, parsePluginSource, type AddCommandOptions } from '../../commands/add';
import {
  buildServerEntry,
  buildRuleEntry,
  buildHookEntry,
  type AddKind,
} from '../../commands/add-builders';
import { tryResolveRegistryItem } from '../../commands/resolve-registry-source';
import { upsertNativeMcpServer } from './native-mcp';
import type { Capabilities, Skill, MCPServer, Plugin } from '../../../types/capabilities';
import type { Rule } from '../../../types/rules';
import type { Hook } from '../../../types/hooks';
import type { GetSnapshotResult } from '../../../shared/cache';
import { getProvider } from '../../../shared/providers';

function expandEnvInRecord(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
      return process.env[name] ?? '';
    });
  }
  return out;
}

async function loadEnvFileOptional(envFile: string | boolean | undefined): Promise<void> {
  if (envFile === undefined || envFile === false) return;
  const { parseEnvFile } = await import('../../../shared/env-parser');
  const path = envFile === true ? resolve(process.cwd(), '.env') : resolve(process.cwd(), String(envFile));
  if (!existsSync(path)) {
    throw new Error(`Environment file not found: ${path}`);
  }
  const vars = parseEnvFile(path);
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

async function openAuthDb(): Promise<{ db: CapaDatabase; settings: Awaited<ReturnType<typeof loadSettings>> }> {
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));
  return { db, settings };
}

async function resolvePassthroughProviders(flagProvider?: string): Promise<string[]> {
  return resolveProviders({
    flagProvider,
    promptMessage: 'Which provider do you want to write files for?',
    missingHint:
      'No provider specified. Pass --provider <id> (required in non-interactive mode).\n\n' +
      '  Example: capa add … --passthrough -p cursor',
  });
}

function emptyCapabilities(providers: string[]): Capabilities {
  return {
    providers,
    skills: [],
    servers: [],
    tools: [],
  };
}

async function passthroughInstallSkill(opts: {
  skill: Skill;
  projectPath: string;
  projectId: string;
  providers: string[];
  db: CapaDatabase;
  settings: Awaited<ReturnType<typeof loadSettings>>;
  noCache: boolean;
  written: string[];
}): Promise<void> {
  const { skill, projectPath, projectId, providers, db, settings, noCache, written } = opts;
  const caps = emptyCapabilities(providers);
  const lockBuilder = new LockfileBuilder(null);
  const outcome = await installOneSkill(
    skill,
    projectPath,
    projectId,
    providers,
    db,
    settings,
    caps,
    join(projectPath, 'capabilities.yaml'),
    lockBuilder,
    noCache,
    new Map(),
    { trackManaged: false },
  );
  if (outcome === 'installed') {
    for (const pid of providers) {
      const prov = getProvider(pid);
      if (prov) written.push(join(projectPath, prov.skillsDir, skill.id));
    }
    console.log(`✓ Passthrough: installed skill "${skill.id}"`);
  } else {
    console.log(`⚠ Skill "${skill.id}" was skipped (${outcome})`);
  }
}

async function passthroughInstallPlugin(opts: {
  plugin: Plugin;
  projectPath: string;
  projectId: string;
  providers: string[];
  db: CapaDatabase;
  noCache: boolean;
  written: string[];
  warnings: string[];
}): Promise<void> {
  const { plugin, projectPath, projectId, providers, db, noCache, written, warnings } = opts;
  const caps = emptyCapabilities(providers);
  caps.plugins = [plugin];
  const authFetch = createAuthenticatedFetch(db);
  const lockBuilder = new LockfileBuilder(null);
  const pluginsBaseDir = join(projectPath, '.capa-passthrough', 'plugins');
  const result = await resolvePlugins(
    caps,
    projectPath,
    projectId,
    authFetch,
    db,
    getRepoSnapshot,
    join(projectPath, 'capabilities.yaml'),
    lockBuilder,
    { noCache, trackManaged: false, pluginsBaseDir },
  );
  warnings.push(...result.warnings);
  for (const skill of result.mergedCapabilities.skills ?? []) {
    if (skill.type !== 'plugin' && skill.type !== 'installed') continue;
    for (const pid of providers) {
      const prov = getProvider(pid);
      if (prov) written.push(join(projectPath, prov.skillsDir, skill.id));
    }
  }
  for (const server of result.mergedCapabilities.servers ?? []) {
    if (server.type !== 'mcp') continue;
    const def = {
      ...server.def,
      env: expandEnvInRecord(server.def.env),
      headers: expandEnvInRecord(server.def.headers),
    };
    const mcpResult = await upsertNativeMcpServer(projectPath, server.id, def, providers);
    warnings.push(...mcpResult.warnings);
    for (const w of mcpResult.written) written.push(`${w.configPath}#${w.serverKey}`);
    if (server.def.url) {
      warnings.push(
        `Server "${server.id}" uses a remote URL — complete OAuth/auth in your provider if required.`,
      );
    }
  }
  console.log(`✓ Passthrough: installed plugin "${plugin.id}"`);
}

export async function passthroughAdd(
  source: string | undefined,
  kind: AddKind,
  options: AddCommandOptions,
): Promise<void> {
  if (kind === 'tool') {
    console.error(
      '✗ Tools cannot be added with --passthrough.\n' +
        '  Provider-native MCP exposes whole servers; capa tool aliases/defaults require managed mode.\n' +
        '  Use: capa add --tool …   (without --passthrough)\n' +
        '  Or:  capa add --server/--plugin … --passthrough',
    );
    process.exit(1);
  }

  await loadEnvFileOptional(options.envFile);
  const providers = await resolvePassthroughProviders(options.provider);
  const projectPath = process.cwd();
  const projectId = generateProjectId(projectPath);
  const written: string[] = [];
  const warnings: string[] = [];

  const { db, settings } = await openAuthDb();
  try {
    // Registry sources (skills-sh:…, claude-plugins:…, …) for skill/plugin kinds
    if ((kind === 'skill' || kind === 'plugin') && source) {
      const resolved = await tryResolveRegistryItem(source);
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
          await passthroughInstallSkill({
            skill: resolved.skill,
            projectPath,
            projectId,
            providers,
            db,
            settings,
            noCache: !!options.noCache,
            written,
          });
        } else if (resolved.capability === 'plugins' && resolved.plugin) {
          await passthroughInstallPlugin({
            plugin: resolved.plugin,
            projectPath,
            projectId,
            providers,
            db,
            noCache: !!options.noCache,
            written,
            warnings,
          });
        }
        // fall through to summary
      } else if (kind === 'skill') {
        const skillDef = await parseSkillSource(source);
        const skill: Skill = { id: skillDef.id, type: skillDef.type, def: skillDef.def };
        await passthroughInstallSkill({
          skill,
          projectPath,
          projectId,
          providers,
          db,
          settings,
          noCache: !!options.noCache,
          written,
        });
      } else if (kind === 'plugin') {
        const parsed = parsePluginSource(source);
        const plugin: Plugin = { id: parsed.idHint, type: parsed.type, def: parsed.def };
        await passthroughInstallPlugin({
          plugin,
          projectPath,
          projectId,
          providers,
          db,
          noCache: !!options.noCache,
          written,
          warnings,
        });
      }
    } else if (kind === 'skill') {
      if (!source) {
        throw new Error('Missing <source>. Example: capa add owner/repo@skill --passthrough');
      }
      const skillDef = await parseSkillSource(source);
      const skill: Skill = { id: skillDef.id, type: skillDef.type, def: skillDef.def };
      await passthroughInstallSkill({
        skill,
        projectPath,
        projectId,
        providers,
        db,
        settings,
        noCache: !!options.noCache,
        written,
      });
    } else if (kind === 'plugin') {
      if (!source) {
        throw new Error('Missing <source>. Example: capa add --plugin owner/repo --passthrough');
      }
      const parsed = parsePluginSource(source);
      const plugin: Plugin = { id: parsed.idHint, type: parsed.type, def: parsed.def };
      await passthroughInstallPlugin({
        plugin,
        projectPath,
        projectId,
        providers,
        db,
        noCache: !!options.noCache,
        written,
        warnings,
      });
    } else if (kind === 'server') {
      if (source) {
        throw new Error('Server mode does not take a positional <source>; use --id/--cmd/--url flags.');
      }
      const entry = buildServerEntry({
        id: options.id,
        type: options.type,
        cmd: options.cmd,
        arg: options.arg,
        env: options.env,
        url: options.url,
        header: options.header,
        cwd: options.cwd,
        description: options.description,
      }) as unknown as MCPServer;
      const def = {
        ...entry.def,
        env: expandEnvInRecord(entry.def.env),
        headers: expandEnvInRecord(entry.def.headers),
      };
      const mcpResult = await upsertNativeMcpServer(projectPath, entry.id, def, providers);
      warnings.push(...mcpResult.warnings);
      for (const w of mcpResult.written) {
        written.push(`${w.configPath}#${w.serverKey}`);
        console.log(`✓ Wrote MCP server "${w.serverKey}" → ${w.configPath} (${w.provider})`);
      }
      if (entry.def.url) {
        console.log('  Note: complete OAuth/auth in your provider if this remote server requires it.');
      }
    } else if (kind === 'rule') {
      const entry = (await buildRuleEntry({
        id: options.id,
        source,
        inline: options.inline,
        appliesTo: options.appliesTo,
        alwaysApply: options.alwaysApply,
        description: options.description,
      })) as unknown as Rule;
      const authFetch = createAuthenticatedFetch(db);
      const body = await resolveRuleBody(entry, {
        capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
        authFetch,
        getRepoSnapshot,
        noCache: !!options.noCache,
      });
      const bodies = new Map([[entry.id, body]]);
      installRules(projectPath, [entry], providers, bodies);
      console.log(`✓ Passthrough: installed rule "${entry.id}"`);
      written.push(`rule:${entry.id}`);
    } else if (kind === 'hook') {
      if (source) {
        throw new Error('Hook mode does not take a positional <source>; use --id/--on/--command flags.');
      }
      const entry = buildHookEntry({
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
      }) as unknown as Hook;
      const authFetch = createAuthenticatedFetch(db);
      const result = await installHooks({
        projectPath,
        projectId,
        capabilitiesFilePath: join(projectPath, 'capabilities.yaml'),
        hooks: [entry],
        providers,
        db,
        authFetch,
        getRepoSnapshot,
        noCache: !!options.noCache,
        trackManaged: false,
        nameTagPrefix: '',
      });
      warnings.push(...result.warnings);
      console.log(`✓ Passthrough: installed hook "${entry.id}" (${result.installed} provider entr${result.installed === 1 ? 'y' : 'ies'})`);
      written.push(`hook:${entry.id}`);
    }
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    try {
      db.close();
    } catch {}
  }

  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  console.log(
    '\nPassthrough write complete. capa clean will not remove these files (no managed state).\n',
  );
  if (written.length > 0) {
    console.log('Paths / keys touched:');
    for (const p of [...new Set(written)].filter(Boolean)) {
      console.log(`  - ${p}`);
    }
    console.log('');
  }
}

export async function passthroughInstall(opts: {
  envFile?: string | boolean;
  provider?: string;
  noCache?: boolean;
  projectPath?: string;
  exitProcess?: boolean;
}): Promise<void> {
  const exitProcess = opts.exitProcess !== false;
  const projectPath = opts.projectPath ? resolve(opts.projectPath) : process.cwd();
  const projectId = generateProjectId(projectPath);

  const { detectCapabilitiesFile } = await import('../../../shared/paths');
  const { parseCapabilitiesFile } = await import('../../../shared/capabilities');

  const capabilitiesFile = await detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    const msg = 'No capabilities file found. Run "capa init" first.';
    console.error(`✗ ${msg}`);
    if (exitProcess) process.exit(1);
    throw new Error(msg);
  }

  await loadEnvFileOptional(opts.envFile);
  let capabilities = await parseCapabilitiesFile(capabilitiesFile.path, capabilitiesFile.format);

  let providers: string[];
  try {
    providers = await resolveProviders({
      flagProvider: opts.provider,
      capabilitiesProviders: capabilities.providers,
      promptMessage: 'Which provider do you want to write files for?',
      missingHint:
        'No provider specified. Pass --provider <id> or add a "providers" section to your capabilities file.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ ${msg}`);
    if (exitProcess) process.exit(1);
    throw err;
  }
  capabilities.providers = providers;

  const { db, settings } = await openAuthDb();
  const authFetch = createAuthenticatedFetch(db);
  const lockBuilder = new LockfileBuilder(null);
  const warnings: string[] = [];
  let added = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const pluginsBaseDir = join(projectPath, '.capa-passthrough', 'plugins');
    const pluginResult = await resolvePlugins(
      capabilities,
      projectPath,
      projectId,
      authFetch,
      db,
      getRepoSnapshot,
      capabilitiesFile.path,
      lockBuilder,
      { noCache: !!opts.noCache, trackManaged: false, pluginsBaseDir },
    );
    warnings.push(...pluginResult.warnings);
    capabilities = pluginResult.mergedCapabilities;
    capabilities.providers = providers;

    const resolvedRepos = new Map<string, GetSnapshotResult>();

    // Skills (non-plugin; plugin skills already copied)
    for (const skill of capabilities.skills ?? []) {
      if (skill.type === 'plugin' || skill.type === 'installed') {
        skipped++;
        continue;
      }
      try {
        const outcome = await installOneSkill(
          skill,
          projectPath,
          projectId,
          providers,
          db,
          settings,
          capabilities,
          capabilitiesFile.path,
          lockBuilder,
          !!opts.noCache,
          resolvedRepos,
          { trackManaged: false },
        );
        if (outcome === 'installed') added++;
        else skipped++;
      } catch (err) {
        failed++;
        warnings.push(
          `Skill "${skill.id}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Rules
    const rules = capabilities.rules ?? [];
    if (rules.length > 0) {
      const bodies = new Map<string, string>();
      for (const rule of rules) {
        try {
          bodies.set(
            rule.id,
            await resolveRuleBody(rule, {
              capabilitiesFilePath: capabilitiesFile.path,
              authFetch,
              getRepoSnapshot,
              noCache: !!opts.noCache,
            }),
          );
        } catch (err) {
          warnings.push(
            `Rule "${rule.id}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      installRules(projectPath, rules, providers, bodies);
      added += bodies.size;
    }

    // Hooks
    const hooks = capabilities.hooks ?? [];
    if (hooks.length > 0) {
      const hookResult = await installHooks({
        projectPath,
        projectId,
        capabilitiesFilePath: capabilitiesFile.path,
        hooks,
        providers,
        db,
        authFetch,
        getRepoSnapshot,
        noCache: !!opts.noCache,
        trackManaged: false,
        nameTagPrefix: '',
      });
      warnings.push(...hookResult.warnings);
      added += hookResult.installed;
    }

    // Native MCP servers (explicit + plugin-merged)
    for (const server of capabilities.servers ?? []) {
      if (server.type !== 'mcp') {
        warnings.push(`Skipping unsupported server type "${(server as MCPServer).type}" (${server.id})`);
        continue;
      }
      const def = {
        ...server.def,
        env: expandEnvInRecord(server.def.env),
        headers: expandEnvInRecord(server.def.headers),
      };
      const mcpResult = await upsertNativeMcpServer(projectPath, server.id, def, providers);
      warnings.push(...mcpResult.warnings);
      added += mcpResult.written.length;
      if (server.def.url) {
        warnings.push(
          `Server "${server.id}": complete OAuth/auth in your provider if required.`,
        );
      }
    }

    // Tools summary
    const tools = capabilities.tools ?? [];
    if (tools.length > 0) {
      const mcpTools = tools.filter((t) => t.type === 'mcp').length;
      const cmdTools = tools.filter((t) => t.type === 'command').length;
      if (mcpTools > 0) {
        warnings.push(
          `Skipped ${mcpTools} MCP tool alias(es) — passthrough exposes whole servers (defaults/formatters dropped).`,
        );
        skipped += mcpTools;
      }
      if (cmdTools > 0) {
        warnings.push(
          `Skipped ${cmdTools} command tool(s) — not representable in provider-native configs.`,
        );
        skipped += cmdTools;
      }
    }

    for (const w of warnings) console.warn(`  ⚠ ${w}`);
    console.log(
      `\n✓ Passthrough install complete (added=${added}, skipped=${skipped}, failed=${failed}).`,
    );
    console.log('  No capa server was started. capa clean will not reverse these writes.\n');
    if (failed > 0 && exitProcess) process.exit(1);
  } finally {
    try {
      db.close();
    } catch {}
  }
}
