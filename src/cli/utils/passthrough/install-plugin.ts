import { join } from 'path';
import { createAuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { LockfileBuilder } from '../../../shared/lockfile';
import { getRepoSnapshot } from '../../commands/install-tasks/helpers/repo-snapshot';
import { resolvePlugins } from '../../commands/plugin-install';
import { getProvider } from '../../../shared/providers';
import { upsertNativeMcpServer } from './native-mcp';
import { runNativePluginInstall, type NativePluginInstall } from './native-plugin-install';
import { expandEnvInRecord, emptyCapabilities, PASSTHROUGH_PLUGINS_DIR } from './env';
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
  const pluginsBaseDir = join(projectPath, PASSTHROUGH_PLUGINS_DIR);
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
    for (const pid of unpackProviders) {
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
    const mcpResult = await upsertNativeMcpServer(projectPath, server.id, def, unpackProviders);
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
