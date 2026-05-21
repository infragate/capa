import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { Capabilities, Skill, MCPServer, SourcePlugin, ResolvedPluginInfo, OAuth2Config } from '../../types/capabilities';
import type { UnifiedPluginManifest } from '../../types/plugin';
import type { CapaDatabase } from '../../db/database';
import type { AuthenticatedFetch } from '../../shared/authenticated-fetch';
import { validatePluginDef, getPluginInstallId } from '../../shared/plugin-source';
import {
  detectAndParseManifest,
  discoverPluginEntries,
  findPluginInDirectory,
  resolvePluginServerDef,
} from '../../shared/plugin-manifest';
import { getProvider } from '../../shared/providers';
import { getGitProvider } from '../../shared/git-providers/registry';
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

/** Base under system temp for extracted plugin content (MCP cwd). Per-project so projects don't clash. */
function getPluginsTempBase(projectId: string): string {
  return join(tmpdir(), 'capa-plugins', projectId);
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
  options: { noCache?: boolean } = {}
): Promise<ResolvePluginsResult> {
  const noCache = !!options.noCache;
  const plugins = capabilities.plugins ?? [];
  const mergedSkills: Skill[] = Array.isArray(capabilities.skills) ? [...capabilities.skills] : [];
  // Preserve all explicitly defined servers from the capabilities file; never drop them when merging plugin servers
  const mergedServers: MCPServer[] = Array.isArray(capabilities.servers) ? [...capabilities.servers] : [];
  const mergedTools = Array.isArray(capabilities.tools) ? [...capabilities.tools] : [];
  const resolvedPlugins: ResolvedPluginInfo[] = [];
  const tempDirs: string[] = [];
  const providers = capabilities.providers;
  if (!providers || providers.length === 0) {
    throw new Error('No providers configured. Resolve providers before calling resolvePlugins.');
  }

  const pluginsBase = getPluginsTempBase(projectId);
  const currentPluginIds = new Set<string>();

  const registeredServerIds = new Set(mergedServers.map(s => s.id));

  // Map of user-declared `type: plugin` skills by id. We attach `sourcePlugin`
  // to these when a matching plugin manifest skill is found, and avoid auto-adding
  // a duplicate auto-merged entry for the same id.
  const userPluginSkills = new Map<string, Skill>();
  for (const skill of mergedSkills) {
    if (skill.type === 'plugin') {
      userPluginSkills.set(skill.id, skill);
    }
  }

  for (const pluginRef of plugins) {
    if (!getGitProvider(pluginRef.type)) continue;
    if (!pluginRef.def?.repo) continue;

    const validated = validatePluginDef(pluginRef);
    if ('error' in validated) {
      console.warn(`  ⚠ Invalid plugin entry ${pluginRef.id ?? pluginRef.def.repo}: ${validated.error}`);
      continue;
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
      console.error(`  ✗ Failed to clone plugin ${repoPath}: ${err.message}`);
      continue;
    }

    // Resolve the manifest root. Three modes:
    //   • `search`  — walk the snapshot for a manifest dir matching the name.
    //   • `subpath` — exact path inside the repo (already provided by the user).
    //   • neither   — the repo root itself is the plugin.
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
        console.warn(
          `  ⚠ Plugin "${search}" not found in ${repoPath}.\n` +
          `    Available plugins: ${availableList}\n` +
          `    Tip: use \`subpath: <path>\` to pin an exact location, or @ to match either the directory name or the manifest's "name" field.`
        );
        continue;
      }
      manifestRoot = located.entry.subpath
        ? join(snapshot.snapshotDir, located.entry.subpath)
        : snapshot.snapshotDir;
      resolvedSubpath = located.entry.subpath;
      manifest = located.manifest;
    } else {
      manifestRoot = subpath ? join(snapshot.snapshotDir, subpath) : snapshot.snapshotDir;
      if (subpath && !existsSync(manifestRoot)) {
        console.warn(`  ⚠ Plugin subpath not found: ${subpath} in ${repoPath}`);
        continue;
      }
      resolvedSubpath = subpath;
      manifest = detectAndParseManifest(manifestRoot, providers);
      if (!manifest) {
        console.warn(`  ⚠ No plugin manifest found in ${repoPath}${subpath ? `/${subpath}` : ''}`);
        continue;
      }
    }

    const pluginInstallId = getPluginInstallId(pluginRef.id ?? manifest.name);
    currentPluginIds.add(pluginInstallId);

    const pluginStablePath = join(pluginsBase, pluginInstallId);
    try {
      if (existsSync(pluginStablePath)) rmSync(pluginStablePath, { recursive: true, force: true });
      copyPluginToStable(manifestRoot, pluginStablePath);
    } catch (err: any) {
      console.error(`  ✗ Failed to copy plugin to ${pluginStablePath}: ${err.message}`);
      continue;
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
    const resolvedPluginInfo: ResolvedPluginInfo = {
      id: pluginInstallId,
      name: manifest.name,
      version: manifest.version,
      provider: manifest.provider,
      repository,
      skills: pluginSkillIds,
      serverIds: pluginServerIds,
    };
    resolvedPlugins.push(resolvedPluginInfo);

    const security = capabilities.options?.security;
    const blockPhrasesEnabled = isBlockedPhrasesEnabled(security);
    const sanitizeEnabled = isCharacterSanitizationEnabled(security);
    const hasSecurity = blockPhrasesEnabled || sanitizeEnabled;
    const blockedPhrases = blockPhrasesEnabled ? loadBlockedPhrases(security, capabilitiesFilePath) : [];
    const allowedCharacters = sanitizeEnabled ? getAllowedCharacters(security) : null;

    for (const entry of manifest.skillEntries) {
      const srcSkillDir = join(pluginStablePath, entry.relativePath);
      if (!existsSync(join(srcSkillDir, 'SKILL.md'))) continue;

      pluginSkillIds.push(entry.id);

      for (const client of providers) {
        const providerEntry = getProvider(client);
        if (!providerEntry) continue;
        const skillsBaseDir = join(projectPath, providerEntry.skillsDir);
        const destSkillDir = join(skillsBaseDir, entry.id);
        try {
          if (existsSync(destSkillDir)) rmSync(destSkillDir, { recursive: true, force: true });
          mkdirSync(resolve(destSkillDir, '..'), { recursive: true });
          if (hasSecurity) {
            copySkillDirWithSecurity(
              srcSkillDir,
              destSkillDir,
              entry.id,
              blockedPhrases,
              allowedCharacters,
              manifest.name
            );
          } else {
            try {
              cpSync(srcSkillDir, destSkillDir, { recursive: true });
            } catch {
              copySkillTree({ src: srcSkillDir, dst: destSkillDir });
            }
          }
          db.addManagedFile(projectId, destSkillDir);
        } catch (err: any) {
          if (err instanceof BlockedPhraseError) {
            throw err;
          }
          console.warn(`  ⚠ Failed to install skill ${entry.id} for ${client}: ${err.message}`);
        }
      }

      // If the user has declared a `type: plugin` skill with this id, attach the
      // sourcePlugin attribution to their entry and skip the auto-merge.
      const userEntry = userPluginSkills.get(entry.id);
      if (userEntry) {
        userEntry.sourcePlugin = sourcePlugin;
        continue;
      }

      // Auto-merge: the plugin contributed this skill and the user didn't
      // declare it explicitly. We still surface it as `type: plugin` so the
      // UI and any downstream tooling can tell where it came from. No
      // `requires` are inferred — declare a `type: plugin` entry in
      // capabilities.yaml to bind tools to the skill.
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
        console.warn(`  ⚠ Plugin server id "${serverId}" collides with an existing server; skipping. Rename with \`servers.${serverKey}.as\` in the plugin entry.`);
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

    if (pluginRef.servers) {
      const manifestKeys = Object.keys(manifest.mcpServers);
      for (const configKey of Object.keys(pluginRef.servers)) {
        if (!manifest.mcpServers[configKey]) {
          const available = manifestKeys.length > 0
            ? `Available servers: ${manifestKeys.join(', ')}`
            : 'The plugin manifest declares no MCP servers.';
          console.warn(`  ⚠ Plugin "${pluginInstallId}": servers config key "${configKey}" does not match any server in the plugin manifest. ${available}`);
        }
      }
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
    resolvedPlugins,
  };

  return { mergedCapabilities, tempDirsToCleanup: tempDirs };
}
