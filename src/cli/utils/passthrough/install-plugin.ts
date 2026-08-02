import { join } from 'path';
import { createAuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { LockfileBuilder } from '../../../shared/lockfile';
import { getRepoSnapshot } from '../../commands/install-tasks/helpers/repo-snapshot';
import { resolvePlugins } from '../../commands/plugin-install';
import { getProvider } from '../../../shared/providers';
import { upsertNativeMcpServer } from './native-mcp';
import { runNativePluginInstall, type NativePluginInstall } from './native-plugin-install';
import { expandEnvInRecord, emptyCapabilities } from './env';
import { installRules } from '../rules-installer';
import { installHooks } from '../hooks-installer';
import { installSubAgentInstructions } from '../agents-file';
import type { CapaDatabase } from '../../../db/database';
import type { Plugin } from '../../../types/capabilities';

export async function passthroughInstallPlugin(opts: {
  plugin: Plugin;
  projectPath: string;
  projectId: string;
  providers: string[];
  db: CapaDatabase;
  noCache: boolean;
  written: string[];
  warnings: string[];
  nativeInstall?: NativePluginInstall;
}): Promise<void> {
  const {
    plugin,
    projectPath,
    projectId,
    providers,
    db,
    noCache,
    written,
    warnings,
    nativeInstall,
  } = opts;

  const nativeProviderIds = nativeInstall
    ? providers.filter((p) => nativeInstall.providerIds.includes(p))
    : [];
  const unpackProviders = providers.filter((p) => !nativeProviderIds.includes(p));

  for (const pid of nativeProviderIds) {
    console.log(`Installing plugin "${plugin.id}" via ${pid} native CLI...`);
    runNativePluginInstall(nativeInstall!.command);
    written.push(`native:${pid}:${nativeInstall!.command}`);
  }

  if (unpackProviders.length === 0) {
    console.log(`✓ Passthrough: installed plugin "${plugin.id}" (native)`);
    return;
  }

  if (nativeProviderIds.length > 0) {
    console.log(
      `Unpacking plugin "${plugin.id}" for provider(s) without a native installer: ${unpackProviders.join(', ')}`,
    );
  }

  const caps = emptyCapabilities(unpackProviders);
  caps.plugins = [plugin];
  const authFetch = createAuthenticatedFetch(db);
  const lockBuilder = new LockfileBuilder(null);
  const capabilitiesFilePath = join(projectPath, 'capabilities.yaml');
  const result = await resolvePlugins(
    caps,
    projectPath,
    projectId,
    authFetch,
    db,
    getRepoSnapshot,
    capabilitiesFilePath,
    lockBuilder,
    { noCache, trackManaged: false },
  );
  warnings.push(...result.warnings);
  const merged = result.mergedCapabilities;

  for (const skill of merged.skills ?? []) {
    if (skill.type !== 'plugin' && skill.type !== 'installed') continue;
    for (const pid of unpackProviders) {
      const prov = getProvider(pid);
      if (prov) written.push(join(projectPath, prov.skillsDir, skill.id));
    }
  }
  for (const server of merged.servers ?? []) {
    if (server.type !== 'mcp') continue;
    const def = {
      ...server.def,
      env: expandEnvInRecord(server.def.env),
      headers: expandEnvInRecord(server.def.headers),
    };
    const mcpResult = await upsertNativeMcpServer(projectPath, server.id, def, unpackProviders);
    warnings.push(...mcpResult.warnings);
    for (const w of mcpResult.written) written.push(`${w.configPath}#${w.serverKey}`);
    if (server.def.url) {
      warnings.push(
        `Server "${server.id}" uses a remote URL — complete OAuth/auth in your provider if required.`,
      );
    }
  }

  const pluginRules = (merged.rules ?? []).filter((r) => r.sourcePlugin);
  if (pluginRules.length > 0) {
    const bodies = new Map<string, string>();
    for (const rule of pluginRules) {
      if (rule.content) bodies.set(rule.id, rule.content);
    }
    installRules(projectPath, pluginRules, unpackProviders, bodies);
    for (const rule of pluginRules) written.push(`rule:${rule.id}`);
  }

  const pluginHooks = (merged.hooks ?? []).filter((h) => h.sourcePlugin);
  if (pluginHooks.length > 0) {
    const hookResult = await installHooks({
      projectPath,
      projectId,
      capabilitiesFilePath,
      hooks: pluginHooks,
      providers: unpackProviders,
      db,
      authFetch,
      getRepoSnapshot,
      noCache,
      trackManaged: false,
      nameTagPrefix: '',
    });
    warnings.push(...hookResult.warnings);
    for (const h of pluginHooks) written.push(`hook:${h.id}`);
  }

  const pluginSubagents = (merged.subagents ?? []).filter((a) => a.sourcePlugin);
  for (const agent of pluginSubagents) {
    installSubAgentInstructions(projectPath, agent, merged, unpackProviders);
    written.push(`subagent:${agent.id}`);
  }

  console.log(`✓ Passthrough: installed plugin "${plugin.id}"`);
}
