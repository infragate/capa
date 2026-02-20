import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { Capabilities, Skill, MCPServer, SourcePlugin, ResolvedPluginInfo } from '../../types/capabilities';
import type { CapaDatabase } from '../../db/database';
import type { AuthenticatedFetch } from '../../shared/authenticated-fetch';
import { parsePluginUri, getRepoPath, getPluginInstallId } from '../../shared/plugin-uri';
import { detectAndParseManifest, resolvePluginServerDef } from '../../shared/plugin-manifest';
import { getAgentConfig } from 'skills/src/agents';
import type { AgentType } from 'skills/src/types';
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

/** Base under system temp for extracted plugin content (MCP cwd). Per-project so projects don't clash. */
function getPluginsTempBase(projectId: string): string {
  return join(tmpdir(), 'capa-plugins', projectId);
}

/**
 * Copy a directory recursively (for environments where fs.cpSync may not exist).
 */
function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = join(src, e.name);
    const destPath = join(dest, e.name);
    if (e.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      mkdirSync(resolve(destPath, '..'), { recursive: true });
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

function copyPluginToStable(tempDir: string, pluginStablePath: string): void {
  mkdirSync(resolve(pluginStablePath, '..'), { recursive: true });
  try {
    cpSync(tempDir, pluginStablePath, { recursive: true });
  } catch {
    copyDirRecursive(tempDir, pluginStablePath);
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
  mkdirSync(destSkillDir, { recursive: true });

  function processEntry(relPath: string): void {
    const srcPath = join(srcSkillDir, relPath);
    const destPath = join(destSkillDir, relPath);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      for (const e of readdirSync(srcPath, { withFileTypes: true })) {
        processEntry(join(relPath, e.name).replace(/\\/g, '/'));
      }
    } else {
      mkdirSync(resolve(destPath, '..'), { recursive: true });
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
    }
  }

  for (const e of readdirSync(srcSkillDir, { withFileTypes: true })) {
    processEntry(e.name);
  }
}

export interface ResolvePluginsResult {
  mergedCapabilities: Capabilities;
  tempDirsToCleanup: string[];
}

/**
 * Resolve all plugins from capabilities: clone, unpack, parse manifest, install skills and build merged capabilities.
 * Caller is responsible for cleaning up tempDirsToCleanup.
 * @param capabilitiesFilePath - Path to capabilities file (for resolving blocked phrases file)
 */
export async function resolvePlugins(
  capabilities: Capabilities,
  projectPath: string,
  projectId: string,
  authFetch: AuthenticatedFetch,
  db: CapaDatabase,
  cloneRepository: (
    platform: 'github' | 'gitlab',
    repoPath: string,
    authFetch: AuthenticatedFetch,
    version?: string,
    ref?: string
  ) => Promise<string>,
  capabilitiesFilePath: string
): Promise<ResolvePluginsResult> {
  const plugins = capabilities.plugins ?? [];
  const mergedSkills: Skill[] = Array.isArray(capabilities.skills) ? [...capabilities.skills] : [];
  // Preserve all explicitly defined servers from the capabilities file; never drop them when merging plugin servers
  const mergedServers: MCPServer[] = Array.isArray(capabilities.servers) ? [...capabilities.servers] : [];
  const mergedTools = Array.isArray(capabilities.tools) ? [...capabilities.tools] : [];
  const resolvedPlugins: ResolvedPluginInfo[] = [];
  const tempDirs: string[] = [];
  const providers = capabilities.providers ?? ['cursor', 'claude-code'];

  const pluginsBase = getPluginsTempBase(projectId);
  const currentPluginIds = new Set<string>();

  for (const pluginRef of plugins) {
    if (pluginRef.type !== 'remote' || !pluginRef.def?.uri) continue;

    const parsed = parsePluginUri(pluginRef.def.uri);
    if (!parsed) {
      console.warn(`  ⚠ Invalid plugin URI: ${pluginRef.def.uri}`);
      continue;
    }

    const repoPath = getRepoPath(parsed);
    const platform = parsed.platform === 'github' ? 'github' : 'gitlab';
    const version = pluginRef.def.version ?? parsed.version;
    const ref = pluginRef.def.ref ?? parsed.ref;

    let tempDir: string;
    try {
      tempDir = await cloneRepository(platform, repoPath, authFetch, version, ref);
      tempDirs.push(tempDir);
    } catch (err: any) {
      console.error(`  ✗ Failed to clone plugin ${repoPath}: ${err.message}`);
      continue;
    }

    const manifest = detectAndParseManifest(tempDir, providers);
    if (!manifest) {
      console.warn(`  ⚠ No plugin manifest found in ${repoPath}`);
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      continue;
    }

    const refOrVersion = ref ?? version ?? '';
    const pluginInstallId = getPluginInstallId(manifest.name, refOrVersion);
    currentPluginIds.add(pluginInstallId);

    const pluginStablePath = join(pluginsBase, pluginInstallId);
    try {
      if (existsSync(pluginStablePath)) rmSync(pluginStablePath, { recursive: true, force: true });
      copyPluginToStable(tempDir, pluginStablePath);
    } catch (err: any) {
      console.error(`  ✗ Failed to copy plugin to ${pluginStablePath}: ${err.message}`);
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
      continue;
    }
    // Remove temp clone immediately; we only needed it to extract files
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    const tempIdx = tempDirs.indexOf(tempDir);
    if (tempIdx !== -1) tempDirs.splice(tempIdx, 1);

    const repository = `https://${parsed.platform}.com/${parsed.owner}/${parsed.repo}`;
    const sourcePlugin: SourcePlugin = {
      id: pluginInstallId,
      name: manifest.name,
      provider: manifest.provider,
    };
    resolvedPlugins.push({
      id: pluginInstallId,
      name: manifest.name,
      version: manifest.version,
      provider: manifest.provider,
      repository,
    });

    const security = capabilities.options?.security;
    const blockPhrasesEnabled = isBlockedPhrasesEnabled(security);
    const sanitizeEnabled = isCharacterSanitizationEnabled(security);
    const hasSecurity = blockPhrasesEnabled || sanitizeEnabled;
    const blockedPhrases = blockPhrasesEnabled ? loadBlockedPhrases(security, capabilitiesFilePath) : [];
    const allowedCharacters = sanitizeEnabled ? getAllowedCharacters(security) : null;

    for (const entry of manifest.skillEntries) {
      const srcSkillDir = join(pluginStablePath, entry.relativePath);
      if (!existsSync(join(srcSkillDir, 'SKILL.md'))) continue;

      for (const client of providers) {
        const agentConfig = getAgentConfig(client as AgentType);
        if (!agentConfig) continue;
        const skillsBaseDir = join(projectPath, agentConfig.skillsDir);
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
              copyDirRecursive(srcSkillDir, destSkillDir);
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

      const firstProviderDir = getAgentConfig(providers[0] as AgentType)?.skillsDir;
      const localPath = firstProviderDir ? join(firstProviderDir, entry.id) : entry.id;
      mergedSkills.push({
        id: entry.id,
        type: 'local',
        def: { path: localPath },
        sourcePlugin,
      });
    }

    for (const [serverKey, serverDef] of Object.entries(manifest.mcpServers)) {
      const resolvedDef = resolvePluginServerDef(serverDef, pluginStablePath);
      const serverId = `plugin-${pluginInstallId}-${serverKey}`;
      const displayName = `${serverKey}-server`;
      if (resolvedDef.url) {
        mergedServers.push({
          id: serverId,
          type: 'mcp',
          def: {
            url: resolvedDef.url,
            headers: resolvedDef.headers,
            oauth2: resolvedDef.oauth2,
          },
          sourcePlugin,
          displayName,
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
          displayName,
        });
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
        } catch {}
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
