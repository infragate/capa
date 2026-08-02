import { resolve } from 'path';
import { resolveProviders } from '../../../shared/providers/resolve';
import { createAuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { LockfileBuilder } from '../../../shared/lockfile';
import { generateProjectId } from '../../../shared/paths';
import { getRepoSnapshot } from '../../commands/install-tasks/helpers/repo-snapshot';
import { installOneSkill } from '../../commands/install-tasks/helpers/install-one-skill';
import { resolveRuleBody } from '../../commands/install-tasks/install-rules';
import { installRules } from '../rules-installer';
import { installHooks } from '../hooks-installer';
import { installSubAgentInstructions } from '../agents-file';
import { resolvePlugins } from '../../commands/plugin-install';
import { upsertNativeMcpServer } from './native-mcp';
import { expandEnvInRecord, loadEnvFileOptional, openAuthDb } from './env';
import type { MCPServer } from '../../../types/capabilities';
import type { GetSnapshotResult } from '../../../shared/cache';

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
    const pluginResult = await resolvePlugins(
      capabilities,
      projectPath,
      projectId,
      authFetch,
      db,
      getRepoSnapshot,
      capabilitiesFile.path,
      lockBuilder,
      { noCache: !!opts.noCache, trackManaged: false },
    );
    warnings.push(...pluginResult.warnings);
    capabilities = pluginResult.mergedCapabilities;
    capabilities.providers = providers;

    const resolvedRepos = new Map<string, GetSnapshotResult>();

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

    const subagents = capabilities.subagents ?? [];
    if (subagents.length > 0) {
      for (const agent of subagents) {
        installSubAgentInstructions(projectPath, agent, capabilities, providers);
        added++;
      }
    }

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
