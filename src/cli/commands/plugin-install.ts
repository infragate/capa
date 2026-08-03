import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'fs';
import { join, resolve } from 'path';
import type { Capabilities, Skill, MCPServer, SourcePlugin, ResolvedPluginInfo, OAuth2Config, SubAgent } from '../../types/capabilities';
import type { UnifiedPluginManifest } from '../../types/plugin';
import type { Rule } from '../../types/rules';
import type { Hook } from '../../types/hooks';
import type { CapaDatabase } from '../../db/database';
import type { AuthenticatedFetch } from '../../shared/authenticated-fetch';
import { validatePluginDef, getPluginInstallId } from '../../shared/plugin-source';
import {
  detectAndParseManifest,
  discoverPluginEntries,
  findPluginInDirectory,
  resolveNestedPluginById,
  resolvePluginServerDef,
  resolvePluginRootInString,
  materializeCommandAsSkill,
} from '../../shared/plugin-manifest';
import { getProjectPluginsDir } from '../../shared/plugin-paths';
import { getProvider } from '../../shared/providers';
import { getGitProvider } from '../../shared/git-providers/registry';
import { assertSafeRepoPath } from '../../shared/repo-file';
import {
  describeUnsafeCapabilityId,
  isSafeCapabilityId,
} from '../../shared/safe-id';
import { toCanonicalOrScopedHookOn } from '../utils/hooks/provider-map';
import { coalescePluginHook } from '../utils/hooks/plugin-hook-merge';
import {
  loadBlockedPhrases,
  checkBlockedPhrases,
  sanitizeContent,
  getAllowedCharacters,
  isTextFile,
  isBlockedPhrasesEnabled,
  isCharacterSanitizationEnabled,
  BlockedPhraseError,
} from '../../shared/skill-security';
import type { GetSnapshotResult, CachePlatform } from '../../shared/cache';
import type { LockfileBuilder } from '../../shared/lockfile';
import type { LockPluginEntry } from '../../types/lockfile';
import { copySkillTree } from '../../shared/skill-copy';

/** Map plugin provider id to capa provider id for hook scoping. */
function pluginProviderToCapaId(provider: 'claude' | 'cursor'): string {
  return provider === 'claude' ? 'claude-code' : 'cursor';
}

function copyPluginToStable(tempDir: string, pluginStablePath: string): void {
  mkdirSync(resolve(pluginStablePath, '..'), { recursive: true });
  try {
    cpSync(tempDir, pluginStablePath, { recursive: true });
  } catch {
    copySkillTree({ src: tempDir, dst: pluginStablePath });
  }
}

/**
 * Copy a skill directory with security checks: blocked phrases and character sanitization.
 * Throws BlockedPhraseError if any text file contains a blocked phrase.
 * @param allowedCharacters - null to skip sanitization
 */
function copySkillDirWithSecurity(
  srcSkillDir: string,
  destSkillDir: string,
  skillId: string,
  blockedPhrases: string[],
  allowedCharacters: string | null,
  pluginName?: string
): void {
  copySkillTree({
    src: srcSkillDir,
    dst: destSkillDir,
    handleFile: ({ relPath, srcPath, destPath }) => {
      const filename = relPath.split(/[/\\]/).pop() ?? '';

      if (isTextFile(filename)) {
        let content: string;
        try {
          content = readFileSync(srcPath, 'utf-8');
        } catch {
          writeFileSync(destPath, readFileSync(srcPath));
          return;
        }
        const check = checkBlockedPhrases(content, blockedPhrases);
        if (check.blocked) {
          throw new BlockedPhraseError(
            `Skill "${skillId}" blocked: file "${relPath}" contains forbidden phrase "${check.phrase}"`,
            skillId,
            relPath,
            check.phrase!,
            pluginName
          );
        }
        const output = allowedCharacters !== null
          ? sanitizeContent(content, allowedCharacters)
          : content;
        writeFileSync(destPath, output, 'utf-8');
      } else {
        writeFileSync(destPath, readFileSync(srcPath));
      }
    },
  });
}

export interface ResolvePluginsResult {
  mergedCapabilities: Capabilities;
  tempDirsToCleanup: string[];
  /** Non-fatal diagnostics surfaced after the listr2 task tree completes (e.g.
   * a per-client skill copy failed but the plugin itself resolved). Fatal
   * problems (clone failed, manifest missing, copy failed) throw instead so
   * the install task is marked as failed rather than silently skipping the
   * plugin. */
  warnings: string[];
}

/**
 * Snapshot resolver injected from install.ts. Returns a stable on-disk path to
 * the repo content at a resolved commit SHA, plus the SHA itself.
 */
export type GetRepoSnapshotFn = (
  platform: CachePlatform,
  repoPath: string,
  authFetch: AuthenticatedFetch,
  opts?: { version?: string; ref?: string; pinnedSha?: string; noCache?: boolean }
) => Promise<GetSnapshotResult>;

/**
 * Resolve all plugins from capabilities: snapshot, unpack, parse manifest, install skills and build merged capabilities.
 * Caller is responsible for cleaning up tempDirsToCleanup. Snapshot directories
 * returned by `getRepoSnapshot` are owned by the cache and must NOT be deleted.
 * @param capabilitiesFilePath - Path to capabilities file (for resolving blocked phrases file)
 */
export async function resolvePlugins(
  capabilities: Capabilities,
  projectPath: string,
  projectId: string,
  authFetch: AuthenticatedFetch,
  db: CapaDatabase,
  getRepoSnapshot: GetRepoSnapshotFn,
  capabilitiesFilePath: string,
  lockBuilder: LockfileBuilder,
  options: {
    noCache?: boolean;
    trackManaged?: boolean;
    pluginsBaseDir?: string;
    /**
     * When true (default), copy each plugin skill into every provider's
     * project-local skills dir (e.g. `.claude/skills`, `.cursor/skills`).
     * Plugins are always unpacked under `~/.capa/plugins/<projectId>/`.
     *
     * Server-side effective-capabilities expansion must pass `false` so
     * `capa wrap` / configure never write provider files into the real
     * project — only `capa install` (and wrap's shadow-workspace install)
     * materialize project-local skill trees.
     */
    materializeProjectSkills?: boolean;
  } = {}
): Promise<ResolvePluginsResult> {
  const noCache = !!options.noCache;
  const trackManaged = options.trackManaged !== false;
  const materializeProjectSkills = options.materializeProjectSkills !== false;
  const plugins = capabilities.plugins ?? [];
  const mergedSkills: Skill[] = Array.isArray(capabilities.skills) ? [...capabilities.skills] : [];
  // Preserve all explicitly defined servers from the capabilities file; never drop them when merging plugin servers
  const mergedServers: MCPServer[] = Array.isArray(capabilities.servers) ? [...capabilities.servers] : [];
  const mergedTools = Array.isArray(capabilities.tools) ? [...capabilities.tools] : [];
  const mergedSubagents: SubAgent[] = Array.isArray(capabilities.subagents)
    ? [...capabilities.subagents]
    : [];
  const mergedHooks: Hook[] = Array.isArray(capabilities.hooks) ? [...capabilities.hooks] : [];
  const mergedRules: Rule[] = Array.isArray(capabilities.rules) ? [...capabilities.rules] : [];
  const resolvedPlugins: ResolvedPluginInfo[] = [];
  const tempDirs: string[] = [];
  const providers: string[] = capabilities.providers ?? [];
  if (providers.length === 0) {
    throw new Error('No providers configured. Resolve providers before calling resolvePlugins.');
  }

  // Same unpack root for install, wrap, and passthrough: ~/.capa/plugins/<projectId>/
  const pluginsBase = options.pluginsBaseDir ?? getProjectPluginsDir(projectId);
  const currentPluginIds = new Set<string>();
  const warnings: string[] = [];

  const registeredServerIds = new Set(mergedServers.map(s => s.id));
  const registeredSubagentIds = new Set(mergedSubagents.map((a) => a.id));
  const registeredHookIds = new Set(mergedHooks.map((h) => h.id));
  const registeredRuleIds = new Set(mergedRules.map((r) => r.id));

  // Map of user-declared `type: plugin` skills by id. We attach `sourcePlugin`
  // to these when a matching plugin manifest skill is found, and avoid auto-adding
  // a duplicate auto-merged entry for the same id.
  const userPluginSkills = new Map<string, Skill>();
  for (const skill of mergedSkills) {
    if (skill.type === 'plugin') {
      userPluginSkills.set(skill.id, skill);
    }
  }

  function installSkillTree(entryId: string, srcSkillDir: string, pluginName: string): void {
    if (!existsSync(join(srcSkillDir, 'SKILL.md'))) return;
    if (!isSafeCapabilityId(entryId)) {
      warnings.push(
        `Plugin "${pluginName}": skipping skill "${entryId}" — ${describeUnsafeCapabilityId('Skill', entryId)}`,
      );
      return;
    }

    for (const client of providers) {
      const providerEntry = getProvider(client);
      if (!providerEntry) continue;
      const skillsBaseDir = join(projectPath, providerEntry.skillsDir);
      let destSkillDir: string;
      try {
        destSkillDir = assertSafeRepoPath(skillsBaseDir, entryId);
      } catch {
        warnings.push(
          `Plugin "${pluginName}": skill "${entryId}" for ${client} resolves outside the skills directory; skipping.`,
        );
        continue;
      }
      try {
        if (existsSync(destSkillDir)) {
          if (!trackManaged) {
            warnings.push(
              `Skill "${entryId}" for ${client}: directory already exists at ${destSkillDir}; ` +
                `passthrough will not overwrite it. Delete it manually and retry.`,
            );
            continue;
          }
          rmSync(destSkillDir, { recursive: true, force: true });
        }
        mkdirSync(resolve(destSkillDir, '..'), { recursive: true });
        if (hasSecurity) {
          copySkillDirWithSecurity(
            srcSkillDir,
            destSkillDir,
            entryId,
            blockedPhrases,
            allowedCharacters,
            pluginName,
          );
        } else {
          try {
            cpSync(srcSkillDir, destSkillDir, { recursive: true });
          } catch {
            copySkillTree({ src: srcSkillDir, dst: destSkillDir });
          }
        }
        if (trackManaged) {
          db.addManagedFile(projectId, destSkillDir);
        }
      } catch (err: any) {
        if (err instanceof BlockedPhraseError) {
          throw err;
        }
        warnings.push(`Failed to install skill "${entryId}" for ${client}: ${err.message}`);
      }
    }
  }

  // Security flags are per-plugin (options are global); set inside the loop.
  let hasSecurity = false;
  let blockedPhrases: string[] = [];
  let allowedCharacters: string | null = null;

  for (const pluginRef of plugins) {
    if (!getGitProvider(pluginRef.type)) continue;
    if (!pluginRef.def?.repo) continue;

    const pluginLabel = pluginRef.id ?? pluginRef.def.repo;
    // Isolate per-plugin failures so one bad entry (marketplace repo root,
    // missing manifest, clone error, …) cannot wipe expansions from the rest.
    let pluginInstallId: string | undefined;
    const mergeSnap = {
      skills: mergedSkills.length,
      servers: mergedServers.length,
      tools: mergedTools.length,
      subagents: mergedSubagents.length,
      hooks: mergedHooks.length,
      rules: mergedRules.length,
      resolved: resolvedPlugins.length,
    };
    try {
      const validated = validatePluginDef(pluginRef);
      if ('error' in validated) {
        throw new Error(
          `Invalid plugin entry ${pluginLabel}: ${validated.error}`
        );
      }

      const { platform, repoPath, subpath, search, version, ref } = validated;

      let snapshot: GetSnapshotResult;
      try {
        const lockEntry = noCache
          ? null
          : lockBuilder.findPlugin({
              source: platform,
              repo: repoPath,
              subpath: subpath || null,
              requestedSearchName: search ?? null,
              requestedVersion: version ?? null,
              requestedRef: ref ?? null,
            });
        const pinnedSha = lockEntry?.resolvedRef;
        snapshot = await getRepoSnapshot(platform, repoPath, authFetch, {
          version,
          ref,
          pinnedSha,
          noCache,
        });
      } catch (err: any) {
        throw new Error(
          `Failed to clone plugin ${repoPath}: ${err.message}`
        );
      }

    // Resolve the manifest root:
    //   • `search`  — walk the snapshot for a manifest dir matching the name.
    //   • `subpath` — exact path inside the repo (already provided by the user).
    //   • neither   — the repo root itself is the plugin; if that has no
    //                 manifest and the entry has an id, search the tree by id
    //                 (multi-plugin marketplace monorepos).
    let manifestRoot: string;
    let resolvedSubpath: string;
    let manifest: UnifiedPluginManifest | null;
    if (search) {
      const located = findPluginInDirectory(snapshot.snapshotDir, search, providers);
      if (!located) {
        const available = discoverPluginEntries(snapshot.snapshotDir, providers)
          .map((e) => e.manifestName || e.dirName)
          .filter(Boolean)
          .sort();
        const availableList = available.length > 0 ? available.join(', ') : 'none';
        throw new Error(
          `Plugin "${search}" not found in ${repoPath}.\n` +
          `    Available plugins: ${availableList}\n` +
          `    Tip: use \`subpath: <path>\` to pin an exact location, or @ to match either the directory name or the manifest's "name" field.`
        );
      }
      manifestRoot = located.entry.subpath
        ? join(snapshot.snapshotDir, located.entry.subpath)
        : snapshot.snapshotDir;
      resolvedSubpath = located.entry.subpath;
      manifest = located.manifest;
    } else {
      manifestRoot = subpath ? join(snapshot.snapshotDir, subpath) : snapshot.snapshotDir;
      if (subpath && !existsSync(manifestRoot)) {
        throw new Error(`Plugin subpath not found: "${subpath}" in ${repoPath}`);
      }
      resolvedSubpath = subpath;
      manifest = detectAndParseManifest(manifestRoot, providers);
      // Multi-plugin monorepos often only have a marketplace catalog at the
      // repo root. When the capa entry has an id, resolve via direct child
      // path or root marketplace.json (bounded — no full-tree walk).
      if (!manifest && !subpath && pluginRef.id) {
        const located = resolveNestedPluginById(
          snapshot.snapshotDir,
          pluginRef.id,
          providers,
        );
        if (located) {
          manifestRoot = located.entry.subpath
            ? join(snapshot.snapshotDir, located.entry.subpath)
            : snapshot.snapshotDir;
          resolvedSubpath = located.entry.subpath;
          manifest = located.manifest;
        }
      }
      if (!manifest) {
        throw new Error(
          `No plugin manifest found in ${repoPath}${subpath ? `/${subpath}` : ''}.\n` +
          `    Expected one of: .claude-plugin/plugin.json, .cursor-plugin/plugin.json.` +
          (pluginRef.id
            ? `\n    Tip: for monorepos, pin the plugin with "${repoPath}@${pluginRef.id}" or "${repoPath}::${pluginRef.id}".`
            : '')
        );
      }
    }

    pluginInstallId = getPluginInstallId(pluginRef.id ?? manifest.name);
    currentPluginIds.add(pluginInstallId);

    const pluginStablePath = resolve(join(pluginsBase, pluginInstallId));
    try {
      if (existsSync(pluginStablePath)) rmSync(pluginStablePath, { recursive: true, force: true });
      copyPluginToStable(manifestRoot, pluginStablePath);
    } catch (err: any) {
      throw new Error(
        `Failed to copy plugin ${pluginInstallId} to ${pluginStablePath}: ${err.message}`
      );
    }

    const lockPluginEntry: LockPluginEntry = {
      id: pluginInstallId,
      source: platform,
      repo: repoPath,
      subpath: resolvedSubpath || null,
      requestedSearchName: search ?? null,
      requestedVersion: version ?? null,
      requestedRef: ref ?? null,
      resolvedRef: snapshot.resolvedSha,
      resolvedVersion: snapshot.resolvedVersion ?? null,
      manifestName: manifest.name,
      manifestVersion: manifest.version ?? null,
    };
    lockBuilder.upsertPlugin(lockPluginEntry);

    const refish = ref ?? version ?? 'HEAD';
    const gp = getGitProvider(platform);
    const host = gp?.host ?? `${platform}.com`;
    const repository = resolvedSubpath
      ? `https://${host}/${repoPath}/tree/${refish}/${resolvedSubpath}`
      : `https://${host}/${repoPath}`;
    const sourcePlugin: SourcePlugin = {
      id: pluginInstallId,
      name: manifest.name,
      provider: manifest.provider,
    };
    const pluginSkillIds: string[] = [];
    const pluginServerIds: string[] = [];
    const pluginSubagentIds: string[] = [];
    const pluginHookIds: string[] = [];
    const pluginRuleIds: string[] = [];
    const resolvedPluginInfo: ResolvedPluginInfo = {
      id: pluginInstallId,
      name: manifest.name,
      version: manifest.version,
      provider: manifest.provider,
      repository,
      skills: pluginSkillIds,
      serverIds: pluginServerIds,
      subagentIds: pluginSubagentIds,
      hookIds: pluginHookIds,
      ruleIds: pluginRuleIds,
    };
    resolvedPlugins.push(resolvedPluginInfo);

    const security = capabilities.options?.security;
    const blockPhrasesEnabled = isBlockedPhrasesEnabled(security);
    const sanitizeEnabled = isCharacterSanitizationEnabled(security);
    hasSecurity = blockPhrasesEnabled || sanitizeEnabled;
    blockedPhrases = blockPhrasesEnabled ? loadBlockedPhrases(security, capabilitiesFilePath) : [];
    allowedCharacters = sanitizeEnabled ? getAllowedCharacters(security) : null;

    if (manifest.skippedArtifacts?.length) {
      warnings.push(
        `Plugin "${manifest.name}" contains unsupported artifacts that were skipped: ${manifest.skippedArtifacts.join(', ')}`,
      );
    }

    // Materialize legacy commands/ into skill dirs on the stable plugin copy
    const commandSkillEntries: { id: string; relativePath: string }[] = [];
    for (const cmd of manifest.commandEntries ?? []) {
      if (!isSafeCapabilityId(cmd.id)) {
        warnings.push(
          `Plugin "${manifest.name}": skipping command "${cmd.id}" — ${describeUnsafeCapabilityId('Command', cmd.id)}`,
        );
        continue;
      }
      let destDir: string;
      try {
        destDir = assertSafeRepoPath(join(pluginStablePath, '.capa-commands'), cmd.id);
      } catch {
        warnings.push(
          `Plugin "${manifest.name}": command "${cmd.id}" resolves outside the plugin copy; skipping.`,
        );
        continue;
      }
      if (materializeCommandAsSkill(pluginStablePath, cmd, destDir)) {
        commandSkillEntries.push({ id: cmd.id, relativePath: join('.capa-commands', cmd.id) });
      }
    }

    const allSkillEntries = [
      ...(manifest.skillEntries ?? []),
      ...commandSkillEntries,
    ];

    for (const entry of allSkillEntries) {
      if (!isSafeCapabilityId(entry.id)) {
        warnings.push(
          `Plugin "${manifest.name}": skipping skill "${entry.id}" — ${describeUnsafeCapabilityId('Skill', entry.id)}`,
        );
        continue;
      }
      const srcSkillDir = join(pluginStablePath, entry.relativePath);
      if (!existsSync(join(srcSkillDir, 'SKILL.md'))) continue;

      pluginSkillIds.push(entry.id);
      if (materializeProjectSkills) {
        installSkillTree(entry.id, srcSkillDir, manifest.name);
      }

      const userEntry = userPluginSkills.get(entry.id);
      if (userEntry) {
        userEntry.sourcePlugin = sourcePlugin;
        continue;
      }

      if (mergedSkills.some((s) => s.id === entry.id)) {
        warnings.push(
          `Plugin skill id "${entry.id}" collides with an existing skill; skipping auto-merge.`,
        );
        continue;
      }

      mergedSkills.push({
        id: entry.id,
        type: 'plugin',
        def: {},
        sourcePlugin,
      });
    }

    for (const [serverKey, serverDef] of Object.entries(manifest.mcpServers)) {
      const config = pluginRef.servers?.[serverKey];
      const serverId = config?.as ?? serverKey;

      if (registeredServerIds.has(serverId)) {
        warnings.push(
          `Plugin server id "${serverId}" collides with an existing server; skipping. ` +
          `Rename with \`servers.${serverKey}.as\` in the plugin entry.`
        );
        continue;
      }
      registeredServerIds.add(serverId);
      pluginServerIds.push(serverId);

      const resolvedDef = resolvePluginServerDef(serverDef, pluginStablePath);
      if (resolvedDef.url) {
        mergedServers.push({
          id: serverId,
          type: 'mcp',
          def: {
            url: resolvedDef.url,
            headers: resolvedDef.headers,
            oauth2: resolvedDef.oauth2 as OAuth2Config | undefined,
          },
          sourcePlugin,
          sourcePluginServerKey: serverKey,
          displayName: serverKey,
        });
      } else if (resolvedDef.cmd) {
        mergedServers.push({
          id: serverId,
          type: 'mcp',
          def: {
            cmd: resolvedDef.cmd,
            args: resolvedDef.args,
            env: resolvedDef.env,
            cwd: pluginStablePath,
          },
          sourcePlugin,
          sourcePluginServerKey: serverKey,
          displayName: serverKey,
        });
      }
    }

    const capaProviderId = pluginProviderToCapaId(manifest.provider);
    const pluginSkillIdSet = new Set(pluginSkillIds);

    for (const agent of manifest.agentEntries ?? []) {
      if (!isSafeCapabilityId(agent.id)) {
        warnings.push(
          `Plugin "${manifest.name}": skipping subagent "${agent.id}" — ${describeUnsafeCapabilityId('Sub-agent', agent.id)}`,
        );
        continue;
      }
      if (registeredSubagentIds.has(agent.id)) {
        warnings.push(
          `Plugin subagent id "${agent.id}" collides with an existing subagent; skipping.`,
        );
        continue;
      }
      if (agent.droppedFrontmatterKeys.length > 0) {
        warnings.push(
          `Plugin agent "${agent.id}": frontmatter fields not mapped into capa subagents: ${agent.droppedFrontmatterKeys.join(', ')}`,
        );
      }
      registeredSubagentIds.add(agent.id);
      pluginSubagentIds.push(agent.id);
      const skillIds = agent.skillIds.filter((id) => pluginSkillIdSet.has(id));
      mergedSubagents.push({
        id: agent.id,
        description: agent.description,
        skills: skillIds,
        tools: [],
        instructions: agent.instructions || undefined,
        sourcePlugin,
      });
    }

    let hookIndex = 0;
    for (const hookEntry of manifest.hookEntries ?? []) {
      const targetProvider = hookEntry.targetProvider ?? capaProviderId;
      const indexHint = hookEntry.idHint || hookIndex;
      hookIndex++;

      // Prefer capa canonical events (SessionStart → sessionStart) so install
      // fans out via eventMap. Keep provider-scoped form only when unmapped.
      const on = toCanonicalOrScopedHookOn(
        targetProvider,
        hookEntry.event,
        hookEntry.matcher,
      );
      const command = hookEntry.command
        ? resolvePluginRootInString(hookEntry.command, pluginStablePath, {
            shellQuote: true,
          })
        : undefined;
      const prompt = hookEntry.prompt
        ? resolvePluginRootInString(hookEntry.prompt, pluginStablePath, {
            shellQuote: true,
          })
        : undefined;

      // Sibling Claude/Cursor manifests often declare the same hook twice.
      // When rewritten bodies match, coalesce into one cross-provider entry.
      const candidate: Hook = {
        id: `plugin-${pluginInstallId}-${indexHint}`,
        on,
        type: hookEntry.type,
        command,
        prompt,
        matcher: hookEntry.matcher,
        timeout: hookEntry.timeout,
        failClosed: hookEntry.failClosed,
        sequential: hookEntry.sequential,
        providers: [targetProvider],
        sourcePlugin,
      };
      if (coalescePluginHook(mergedHooks, pluginInstallId, candidate, targetProvider)) {
        continue;
      }

      let hookId = candidate.id;
      if (registeredHookIds.has(hookId)) {
        hookId = `plugin-${pluginInstallId}-${targetProvider}-${indexHint}`;
        if (registeredHookIds.has(hookId)) {
          warnings.push(`Plugin hook id "${hookId}" collides with an existing hook; skipping.`);
          continue;
        }
        candidate.id = hookId;
      }
      if (hookEntry.matcher && /mcp__plugin_/i.test(hookEntry.matcher)) {
        warnings.push(
          `Plugin hook "${hookId}": matcher references plugin-scoped MCP tools (${hookEntry.matcher}); ` +
            `it may not fire after capa proxies MCP under its own server id.`,
        );
      }
      registeredHookIds.add(hookId);
      pluginHookIds.push(hookId);
      mergedHooks.push(candidate);
    }

    for (const ruleEntry of manifest.ruleEntries ?? []) {
      if (!isSafeCapabilityId(ruleEntry.id)) {
        warnings.push(
          `Plugin "${manifest.name}": skipping rule "${ruleEntry.id}" — ${describeUnsafeCapabilityId('Rule', ruleEntry.id)}`,
        );
        continue;
      }
      if (registeredRuleIds.has(ruleEntry.id)) {
        warnings.push(
          `Plugin rule id "${ruleEntry.id}" collides with an existing rule; skipping.`,
        );
        continue;
      }
      registeredRuleIds.add(ruleEntry.id);
      pluginRuleIds.push(ruleEntry.id);
      mergedRules.push({
        id: ruleEntry.id,
        type: 'inline',
        content: ruleEntry.content,
        description: ruleEntry.description,
        appliesTo: ruleEntry.appliesTo,
        alwaysApply: ruleEntry.alwaysApply,
        sourcePlugin,
      });
    }

    if (pluginRef.servers) {
      const manifestKeys = Object.keys(manifest.mcpServers);
      for (const configKey of Object.keys(pluginRef.servers)) {
        if (!manifest.mcpServers[configKey]) {
          const available = manifestKeys.length > 0
            ? `Available servers: ${manifestKeys.join(', ')}`
            : 'The plugin manifest declares no MCP servers.';
          warnings.push(
            `Plugin "${pluginInstallId}": servers config key "${configKey}" does not match any server in the plugin manifest. ${available}`
          );
        }
      }
    }
    } catch (err: unknown) {
      if (err instanceof BlockedPhraseError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (pluginInstallId) {
        currentPluginIds.delete(pluginInstallId);
        lockBuilder.removePlugin(pluginInstallId);
        mergedSkills.length = mergeSnap.skills;
        mergedServers.length = mergeSnap.servers;
        mergedTools.length = mergeSnap.tools;
        mergedSubagents.length = mergeSnap.subagents;
        mergedHooks.length = mergeSnap.hooks;
        mergedRules.length = mergeSnap.rules;
        resolvedPlugins.length = mergeSnap.resolved;
        for (const skill of mergedSkills) {
          if (skill.sourcePlugin?.id === pluginInstallId) {
            delete skill.sourcePlugin;
          }
        }
        registeredServerIds.clear();
        for (const server of mergedServers) registeredServerIds.add(server.id);
        registeredSubagentIds.clear();
        for (const agent of mergedSubagents) registeredSubagentIds.add(agent.id);
        registeredHookIds.clear();
        for (const hook of mergedHooks) registeredHookIds.add(hook.id);
        registeredRuleIds.clear();
        for (const rule of mergedRules) registeredRuleIds.add(rule.id);
        const partialDir = resolve(join(pluginsBase, pluginInstallId));
        if (existsSync(partialDir)) {
          try {
            rmSync(partialDir, { recursive: true, force: true });
          } catch {
            // best-effort cleanup of a partially copied plugin tree
          }
        }
      }
      warnings.push(
        `Plugin "${pluginLabel}" failed to resolve and was skipped: ${message}`,
      );
    }
  }

  for (const server of mergedServers) {
    if (!server.sourcePlugin) continue;
    currentPluginIds.add(server.sourcePlugin.id);
  }

  const pluginsDirFull = pluginsBase;
  if (existsSync(pluginsDirFull)) {
    const dirs = readdirSync(pluginsDirFull, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      if (!currentPluginIds.has(d.name)) {
        const toRemove = join(pluginsDirFull, d.name);
        try {
          rmSync(toRemove, { recursive: true, force: true });
        } catch (err) {
          console.warn(`Failed to clean up plugin directory: ${(err as Error).message}`);
        }
      }
    }
  }

  const mergedCapabilities: Capabilities = {
    ...capabilities,
    skills: mergedSkills,
    servers: mergedServers,
    tools: mergedTools,
    subagents: mergedSubagents.length > 0 ? mergedSubagents : capabilities.subagents,
    hooks: mergedHooks.length > 0 ? mergedHooks : capabilities.hooks,
    rules: mergedRules.length > 0 ? mergedRules : capabilities.rules,
    resolvedPlugins,
  };

  return { mergedCapabilities, tempDirsToCleanup: tempDirs, warnings };
}
