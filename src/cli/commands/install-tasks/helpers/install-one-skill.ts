import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import type { Skill, Capabilities } from '../../../../types/capabilities';
import type { CapaDatabase } from '../../../../db/database';
import { createAuthenticatedFetch, AuthenticatedFetch } from '../../../../shared/authenticated-fetch';
import { displayIntegrationPrompt, getIntegrationsUrl, parseRepoUrl } from '../../../utils/integration-helper';
import { getProvider, getAllProviders } from '../../../../shared/providers';
import { getGitProvider } from '../../../../shared/git-providers/registry';
import { LockfileBuilder } from '../../../../shared/lockfile';
import { assertSafeRepoPath } from '../../../../shared/repo-file';
import { copySkillTree } from '../../../../shared/skill-copy';
import { parseRepoString } from '../../../../shared/repo-string';
import {
  loadBlockedPhrases,
  checkBlockedPhrases,
  sanitizeContent,
  getAllowedCharacters,
  isTextFile,
  isBlockedPhrasesEnabled,
  isCharacterSanitizationEnabled,
  reportBlockedPhraseAndExit,
} from '../../../../shared/skill-security';
import { type CachePlatform, type GetSnapshotResult } from '../../../../shared/cache';
import type { LockSkillEntry } from '../../../../types/lockfile';
import { isVerbose } from '../../../ui';
import { getRepoSnapshot } from './repo-snapshot';
import { findSkillsInDirectory, readSkillFromDirectory } from './skill-discovery';
import type { SkillInstallOutcome } from '../context';

function buildInvalidSkillMessage(skill: Skill): string {
  const lines = [`Invalid skill definition: ${skill.id}`];
  if (!skill.type || !['inline', 'remote', 'github', 'gitlab', 'local', 'installed', 'plugin'].includes(skill.type)) {
    lines.push(`  Invalid or missing 'type'. Must be one of: 'inline', 'remote', 'github', 'gitlab', 'local', 'installed', 'plugin'`);
    lines.push(`  Current value: ${skill.type || '(not set)'}`);
  } else if (skill.type === 'inline') {
    lines.push(`  Type is 'inline' but 'def.content' is missing`);
  } else if (skill.type === 'local') {
    lines.push(`  Type is 'local' but 'def.path' is missing`);
  } else if (skill.type === 'github') {
    lines.push(`  Type is 'github' but 'def.repo' is missing or invalid`);
    if (skill.def.repo) lines.push(`  Current value: '${skill.def.repo}'`);
  } else if (skill.type === 'gitlab') {
    lines.push(`  Type is 'gitlab' but 'def.repo' is missing or invalid`);
    if (skill.def.repo) lines.push(`  Current value: '${skill.def.repo}'`);
  } else if (skill.type === 'remote') {
    lines.push(`  Type is 'remote' but 'def.url' is missing`);
  }
  return lines.join('\n');
}

export async function installOneSkill(
  skill: Skill,
  projectPath: string,
  projectId: string,
  clients: string[],
  db: CapaDatabase,
  settings: any,
  capabilities: Capabilities,
  capabilitiesFilePath: string,
  lockBuilder: LockfileBuilder,
  noCache: boolean,
  resolvedRepos: Map<string, GetSnapshotResult>,
): Promise<SkillInstallOutcome> {
  const authFetch = createAuthenticatedFetch(db);

  let skillMarkdown: string;
  let additionalFiles: Map<string, string> = new Map();
  let skillSourceDir: string | null = null;

  if (skill.type === 'installed') {
    return 'skipped';
  } else if (skill.type === 'plugin') {
    return 'skipped';
  } else if (skill.type === 'inline' && skill.def.content) {
    skillMarkdown = skill.def.content;
  } else if (skill.type === 'local' && skill.def.path) {
    try {
      const skillDir = resolve(projectPath, skill.def.path);
      const skillMdPath = join(skillDir, 'SKILL.md');
      if (!existsSync(skillMdPath)) {
        throw new Error(`SKILL.md not found at ${skillMdPath}`);
      }
      skillSourceDir = skillDir;
      const skillData = readSkillFromDirectory(skillMdPath);
      skillMarkdown = skillData.markdown;
      additionalFiles = skillData.additionalFiles;
    } catch (error: any) {
      throw new Error(`Failed to install local skill ${skill.id}: ${error.message || error}`);
    }
  } else if ((skill.type === 'github' || skill.type === 'gitlab') && skill.def.repo) {
    const platform: CachePlatform = skill.type;
    const platformLabel = getGitProvider(platform)?.displayName ?? platform;
    try {
      // Parse "owner/repo@name" (recursive search) or
      // "owner/repo::path/to/skill" (exact path), with optional :version / #sha
      let parsed;
      try {
        parsed = parseRepoString(skill.def.repo);
      } catch (err: any) {
        throw new Error(
          `Invalid ${platformLabel} repo format for skill "${skill.id}": ${err.message}`
        );
      }
      const repoPath = parsed.ownerRepo;
      const skillTarget = parsed.target;

      // `version`/`ref` from the def take precedence over what's parsed off
      // the repo string, mirroring how the lockfile keys these skills.
      const version = skill.def.version ?? parsed.version;
      const ref = skill.def.ref ?? parsed.sha;

      const repoKey = `${platform}:${repoPath}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`;
      let snapshot = resolvedRepos.get(repoKey);

      if (!snapshot) {
        const lockEntry = noCache
          ? null
          : lockBuilder.findSkill(skill.id, version ?? null, ref ?? null);
        const pinnedSha = lockEntry?.resolvedRef;

        const sourceLabel = pinnedSha
          ? ` (cached @ ${pinnedSha.slice(0, 7)})`
          : version
            ? ` (version: ${version})`
            : ref
              ? ` (commit: ${ref})`
              : '';
        if (isVerbose()) {
          console.log(`    Resolving repository: ${repoPath}${sourceLabel}...`);
        }

        try {
          snapshot = await getRepoSnapshot(platform, repoPath, authFetch, {
            version,
            ref,
            pinnedSha,
            noCache,
          });
          resolvedRepos.set(repoKey, snapshot);
        } catch (err: any) {
          const message: string = err?.message ?? String(err);
          const hasAuth = authFetch.hasAuth(`https://${platform}.com/${repoPath}`);
          const suggestsIntegration =
            (!hasAuth && message.includes('not accessible')) ||
            message.includes('authentication failed');
          const suffix = suggestsIntegration
            ? `\nConnect ${platformLabel} at: ${getIntegrationsUrl(settings.server.host, settings.server.port)}`
            : '';
          throw new Error(`${message}${suffix}`);
        }
      }

      // For both `@` and `::` forms we record the right-hand side as `skillName`
      // — consumers of the lockfile only use it for human-readable display.
      const lockEntry: LockSkillEntry = {
        id: skill.id,
        source: platform,
        repo: repoPath,
        skillName: skillTarget,
        requestedVersion: version ?? null,
        requestedRef: ref ?? null,
        resolvedRef: snapshot.resolvedSha,
        resolvedVersion: snapshot.resolvedVersion ?? null,
      };
      lockBuilder.upsertSkill(lockEntry);

      // Locate the skill directory. `@` form searches the snapshot recursively
      // for a directory named `skillTarget` containing SKILL.md; `::` form
      // expects the directory at exactly that path.
      let skillMdPath: string | undefined;

      if (parsed.mode === 'exact') {
        // Reject `..` / absolute / drive-letter paths before joining so a
        // crafted capabilities entry can't read SKILL.md from outside the
        // snapshot. Shares the same guard as `fetchRepoFile`.
        let skillDir: string;
        try {
          skillDir = assertSafeRepoPath(snapshot.snapshotDir, skillTarget);
        } catch (err: any) {
          throw new Error(
            `${err.message}\n` +
            `    Repository: ${repoPath}\n` +
            `    Snapshot:   ${snapshot.resolvedSha.slice(0, 7)}`
          );
        }
        const candidate = join(skillDir, 'SKILL.md');
        if (!existsSync(candidate)) {
          throw new Error(
            `SKILL.md not found at exact path "${skillTarget}/SKILL.md".\n` +
            `    Repository: ${repoPath}\n` +
            `    Snapshot:   ${snapshot.resolvedSha.slice(0, 7)}\n` +
            `    Tip: Use "${repoPath}@${basename(skillTarget)}" to search the repo recursively for a SKILL.md.`
          );
        }
        skillMdPath = candidate;
      } else {
        const foundSkills = findSkillsInDirectory(snapshot.snapshotDir);
        if (!foundSkills.has(skillTarget)) {
          const available = Array.from(foundSkills.keys()).sort();
          throw new Error(
            `Skill "${skillTarget}" not found in repository.\n` +
            `    Repository: ${repoPath}\n` +
            `    Available skills: ${available.join(', ') || 'none'}\n` +
            `    Tip: The "@" separator matches by directory basename and SKILL.md frontmatter name. ` +
            `For an exact path, use "${repoPath}::path/to/${skillTarget}" instead.`
          );
        }
        skillMdPath = foundSkills.get(skillTarget)!;
      }

      const skillData = readSkillFromDirectory(skillMdPath);
      skillSourceDir = dirname(skillMdPath);
      skillMarkdown = skillData.markdown;
      additionalFiles = skillData.additionalFiles;
    } catch (error: any) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  } else if (skill.type === 'remote' && skill.def.url) {
    try {
      const response = await authFetch.fetch(skill.def.url);

      if (!response.ok) {
        if (AuthenticatedFetch.isPrivateRepoError(response) && !authFetch.hasAuth(skill.def.url)) {
          const repoInfo = parseRepoUrl(skill.def.url);
          if (repoInfo && repoInfo.platform) {
            const integrationsUrl = getIntegrationsUrl(settings.server.host, settings.server.port);
            console.error(`\n  ✗ Unable to access URL (it may require authentication)`);
            displayIntegrationPrompt(getGitProvider(repoInfo.platform)?.displayName ?? repoInfo.platform, integrationsUrl);
            try { db.close(); } catch {}
            process.exit(1);
          }
        }
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }
      skillMarkdown = await response.text();
    } catch (error: any) {
      throw new Error(`Failed to fetch skill ${skill.id}: ${error.message || error}`);
    }
  } else {
    throw new Error(buildInvalidSkillMessage(skill));
  }

  const security = capabilities.options?.security;
  const blockPhrasesEnabled = isBlockedPhrasesEnabled(security);
  const sanitizeEnabled = isCharacterSanitizationEnabled(security);

  if (blockPhrasesEnabled) {
    let blockedPhrases: string[];
    try {
      blockedPhrases = loadBlockedPhrases(security, capabilitiesFilePath);
    } catch (err: any) {
      throw new Error(`Failed to load blocked phrases for skill ${skill.id}: ${err.message}`);
    }
    const mdCheck = checkBlockedPhrases(skillMarkdown, blockedPhrases);
    if (mdCheck.blocked) {
      reportBlockedPhraseAndExit(skill.id, 'SKILL.md', mdCheck.phrase!);
    }
    for (const [filename, content] of additionalFiles) {
      if (!isTextFile(filename)) continue;
      const check = checkBlockedPhrases(content, blockedPhrases);
      if (check.blocked) {
        reportBlockedPhraseAndExit(skill.id, filename, check.phrase!);
      }
    }
  }

  if (sanitizeEnabled) {
    const allowedCharacters = getAllowedCharacters(security);
    if (allowedCharacters !== null) {
      skillMarkdown = sanitizeContent(skillMarkdown, allowedCharacters);
      const sanitizedAdditional = new Map<string, string>();
      for (const [filename, content] of additionalFiles) {
        sanitizedAdditional.set(
          filename,
          isTextFile(filename) ? sanitizeContent(content, allowedCharacters) : content
        );
      }
      additionalFiles = sanitizedAdditional;
    }
  }

  for (const client of clients) {
    const providerEntry = getProvider(client);

    if (!providerEntry) {
      console.error(`  ✗ Unknown client: ${client}`);
      console.error(`\n  Supported clients:`);

      const supportedAgents = getAllProviders()
        .map((p) => ({ name: p.id, displayName: p.displayName }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

      const maxDisplayNameLength = Math.max(...supportedAgents.map((a) => a.displayName.length));
      for (const agent of supportedAgents) {
        console.error(`    - ${agent.displayName.padEnd(maxDisplayNameLength)} (${agent.name})`);
      }

      try { db.close(); } catch {}
      process.exit(1);
    }

    const skillsBaseDir = join(projectPath, providerEntry.skillsDir);
    const skillDir = join(skillsBaseDir, skill.id);
    const skillMdPath = join(skillDir, 'SKILL.md');

    if (existsSync(skillDir)) {
      const managedFiles = db.getManagedFiles(projectId);
      if (!managedFiles.includes(skillDir)) {
        console.error(
          `  ✗ Directory already exists and is not managed by capa: ${skillDir}`
        );
        console.error('    Please delete it manually and run "capa install" again.');
        try { db.close(); } catch {}
        process.exit(1);
      }
      rmSync(skillDir, { recursive: true, force: true });
    }

    if (skillSourceDir) {
      copySkillTree({ src: skillSourceDir, dst: skillDir });
      writeFileSync(skillMdPath, skillMarkdown, 'utf-8');
      for (const [filePath, content] of additionalFiles) {
        if (!isTextFile(filePath)) continue;
        const fullPath = join(skillDir, filePath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, 'utf-8');
      }
    } else {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(skillMdPath, skillMarkdown, 'utf-8');
      for (const [filePath, content] of additionalFiles) {
        const fullPath = join(skillDir, filePath);
        const fileDir = dirname(fullPath);
        if (!existsSync(fileDir)) {
          mkdirSync(fileDir, { recursive: true });
        }
        writeFileSync(fullPath, content, 'utf-8');
      }
    }

    db.addManagedFile(projectId, skillDir);
  }

  return 'installed';
}
