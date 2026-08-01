import { join } from 'path';
import { createAuthenticatedFetch } from '../../../shared/authenticated-fetch';
import { generateProjectId } from '../../../shared/paths';
import { getRepoSnapshot } from '../../commands/install-tasks/helpers/repo-snapshot';
import { resolveRuleBody } from '../../commands/install-tasks/install-rules';
import { installRules } from '../rules-installer';
import { installHooks } from '../hooks-installer';
import { parseSkillSource } from '../../commands/add-parse-skill';
import { parsePluginSource } from '../../commands/add-parse-plugin';
import type { AddCommandOptions } from '../../commands/add';
import {
  buildServerEntry,
  buildRuleEntry,
  buildHookEntry,
  type AddKind,
} from '../../commands/add-builders';
import { tryResolveRegistryItem } from '../../commands/resolve-registry-source';
import { upsertNativeMcpServer } from './native-mcp';
import { passthroughInstallSkill } from './install-skill';
import { passthroughInstallPlugin } from './install-plugin';
import { expandEnvInRecord, loadEnvFileOptional, openAuthDb, resolvePassthroughProviders } from './env';
import type { Skill, MCPServer } from '../../../types/capabilities';
import type { Plugin } from '../../../types/capabilities';
import type { Rule } from '../../../types/rules';
import type { Hook } from '../../../types/hooks';

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
            nativeInstall: resolved.nativeInstall,
          });
        }
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
