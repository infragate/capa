import { detectCapabilitiesFile } from '../../shared/paths';
import { parseCapabilitiesFile, writeCapabilitiesFile } from '../../shared/capabilities';
import { installCommand } from './install';
import { RegistryManager } from '../../shared/registries/manager';
import type { Skill } from '../../types/capabilities';
import type { Plugin, PluginDefinition } from '../../types/plugin';
import type { RegistryCapability } from '../../types/registry';
import { validatePluginDef } from '../../shared/plugin-source';
import { getAllGitProviders } from '../../shared/git-providers/registry';
import { resolve, basename, join, relative } from 'path';
import { access } from 'fs/promises';
import { constants } from 'fs';

interface ParsedSkillSource {
  id: string;
  type: 'remote' | 'github' | 'gitlab' | 'local';
  def: {
    repo?: string;
    url?: string;
    path?: string;     // For local skills: path to directory containing SKILL.md
    version?: string;  // Tag or version like "1.2.1" or "v1.2.1"
    ref?: string;      // Commit SHA
  };
}

/**
 * Parse a skill source URL/path and convert it to a skill definition
 *
 * Repo strings accept two grammars (decided at install time by `parseRepoString`):
 *   `owner/repo@<name>`     — capa searches the cloned repo recursively for
 *                             a directory named `<name>` containing SKILL.md
 *   `owner/repo::<path>`    — exact directory path inside the repo
 * Both can be suffixed with `:version` or `#sha` for pinning.
 *
 * @internal Exported for testing purposes
 */
export async function parseSkillSource(source: string): Promise<ParsedSkillSource> {
  // GitHub exact-path syntax: vercel-labs/agent-skills::skills/web-researcher
  // The path can contain slashes; we still strip an optional :version or #sha suffix.
  const githubExactMatch = source.match(
    /^([\w.-]+\/[\w.-]+)::([\w./-]+?)(?::([\w.-]+)|#([a-f0-9]{7,40}))?$/i
  );
  if (githubExactMatch) {
    const [, repo, path, version, ref] = githubExactMatch;
    return {
      id: basename(path),
      type: 'github',
      def: {
        repo: `${repo}::${path}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`,
        ...(version && { version }),
        ...(ref && { ref })
      }
    };
  }

  // GitHub short syntax with skill name: vercel-labs/agent-skills@skill-name
  // With optional version: owner/repo@skill:1.2.1 or commit: owner/repo@skill#abc123
  // Note: GitHub doesn't support nested paths, only owner/repo structure
  const githubAtMatch = source.match(/^([\w.-]+\/[\w.-]+)@([\w-]+)(?::([\w.-]+)|#([a-f0-9]{7,40}))?$/i);
  if (githubAtMatch) {
    const [, repo, skillName, version, ref] = githubAtMatch;
    return {
      id: skillName,
      type: 'github',
      def: {
        repo: `${repo}@${skillName}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`,
        ...(version && { version }),
        ...(ref && { ref })
      }
    };
  }
  
  // Full GitHub URL with specific skill path
  // https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
  // https://github.com/owner/repo/tree/v1.2.1/skills/skill-name (with version)
  // https://github.com/owner/repo/tree/abc123/skills/skill-name (with SHA)
  const githubPathMatch = source.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/tree\/([\w.-]+)\/skills\/([\w-]+)/);
  if (githubPathMatch) {
    const [, repo, branchOrRef, skillName] = githubPathMatch;
    const isShaRef = /^[a-f0-9]{7,40}$/i.test(branchOrRef);
    const isVersionRef = /^v?\d+\.\d+/.test(branchOrRef);
    
    return {
      id: skillName,
      type: 'github',
      def: {
        repo: `${repo}@${skillName}${isShaRef ? '#' + branchOrRef : isVersionRef ? ':' + branchOrRef : ''}`,
        ...(isShaRef && { ref: branchOrRef }),
        ...(isVersionRef && { version: branchOrRef })
      }
    };
  }

  // GitLab exact-path syntax: gitlab:group/sub/repo::skills/path/skill-name
  const gitlabExactMatch = source.match(
    /^gitlab:([\w.-]+(?:\/[\w.-]+)+)::([\w./-]+?)(?::([\w.-]+)|#([a-f0-9]{7,40}))?$/i
  );
  if (gitlabExactMatch) {
    const [, repo, path, version, ref] = gitlabExactMatch;
    return {
      id: basename(path),
      type: 'gitlab',
      def: {
        repo: `${repo}::${path}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`,
        ...(version && { version }),
        ...(ref && { ref })
      }
    };
  }

  // GitLab prefix syntax with skill name: gitlab:group/subgroup/repo@skill-name
  // With optional version: gitlab:group/repo@skill:1.2.1 or commit: gitlab:group/repo@skill#abc123
  // GitLab supports nested groups, so we match one or more path segments
  const gitlabAtMatch = source.match(/^gitlab:([\w.-]+(?:\/[\w.-]+)+)@([\w-]+)(?::([\w.-]+)|#([a-f0-9]{7,40}))?$/i);
  if (gitlabAtMatch) {
    const [, repo, skillName, version, ref] = gitlabAtMatch;
    return {
      id: skillName,
      type: 'gitlab',
      def: {
        repo: `${repo}@${skillName}${version ? ':' + version : ''}${ref ? '#' + ref : ''}`,
        ...(version && { version }),
        ...(ref && { ref })
      }
    };
  }
  
  // GitLab URL with specific skill path
  // https://gitlab.com/tony.z.1711/example-skills/-/tree/main/skills/example-skill
  // https://gitlab.com/group/subgroup/project/-/tree/main/skills/example-skill
  // https://gitlab.com/group/repo/-/tree/v1.2.1/skills/skill-name (with version)
  // https://gitlab.com/group/repo/-/tree/abc123/skills/skill-name (with SHA)
  // GitLab supports nested groups, so we match one or more path segments
  const gitlabPathMatch = source.match(/^https?:\/\/gitlab\.com\/([\w.-]+(?:\/[\w.-]+)+)\/-\/tree\/([\w.-]+)\/skills\/([\w-]+)/);
  if (gitlabPathMatch) {
    const [, repo, branchOrRef, skillName] = gitlabPathMatch;
    const isShaRef = /^[a-f0-9]{7,40}$/i.test(branchOrRef);
    const isVersionRef = /^v?\d+\.\d+/.test(branchOrRef);
    
    return {
      id: skillName,
      type: 'gitlab',
      def: {
        repo: `${repo}@${skillName}${isShaRef ? '#' + branchOrRef : isVersionRef ? ':' + branchOrRef : ''}`,
        ...(isShaRef && { ref: branchOrRef }),
        ...(isVersionRef && { version: branchOrRef })
      }
    };
  }
  
  // Local path: ./my-local-skills or /absolute/path (references local file; path stored for install)
  if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/') || /^[A-Za-z]:/.test(source)) {
    const absPath = resolve(process.cwd(), source);
    const id = basename(absPath);
    const skillMdPath = join(absPath, 'SKILL.md');

    try {
      await access(skillMdPath, constants.R_OK);
      console.log(`✓ Found SKILL.md at ${skillMdPath}`);
    } catch {
      throw new Error(
        `No SKILL.md found at ${skillMdPath}.\n` +
        `Local skills must point to a directory that contains a SKILL.md file.`
      );
    }

    // Store path relative to project root (cwd) for portability when possible
    const projectRoot = process.cwd();
    const pathToStore = absPath.startsWith(projectRoot)
      ? relative(projectRoot, absPath)
      : absPath;

    return {
      id,
      type: 'local',
      def: {
        path: pathToStore
      }
    };
  }
  
  // Any other HTTP/HTTPS URL - treat as remote
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const id = basename(source).replace(/\.md$/i, '') || 'custom-skill';
    return {
      id,
      type: 'remote',
      def: {
        url: source
      }
    };
  }
  
  // Fallback - treat as invalid
  throw new Error(
    `Unable to parse skill source: ${source}\n\n` +
    `Supported formats:\n` +
    `  GitHub:\n` +
    `    - Recursive search:  owner/repo@skill-name\n` +
    `    - Exact path:        owner/repo::skills/path/to/skill-name\n` +
    `    - URL:               https://github.com/owner/repo/tree/main/skills/skill-name\n` +
    `  GitLab:\n` +
    `    - Recursive search:  gitlab:owner/repo@skill-name\n` +
    `    - Exact path:        gitlab:owner/repo::skills/path/to/skill-name\n` +
    `    - URL:               https://gitlab.com/owner/repo/-/tree/main/skills/skill-name\n` +
    `  Local path:            ./my-local-skills (directory containing SKILL.md)\n` +
    `  Remote SKILL.md URL:   https://example.com/path/to/SKILL.md\n\n` +
    `Pinning (any of the above):\n` +
    `  - Tag:    capa add owner/repo@skill:v1.2.3\n` +
    `  - Commit: capa add gitlab:group/repo@skill#abc123def\n` +
    `  - Latest: capa add owner/repo@skill\n\n` +
    `When to use which:\n` +
    `  Use "@" when the skill folder name is unique in the repo.\n` +
    `  Use "::" when you need an exact path (e.g. two skills share a name).`
  );
}

interface ParsedPluginSource {
  type: 'github' | 'gitlab';
  def: PluginDefinition;
  idHint: string;
}

function buildPluginSourceFromRepoUrl(
  providerId: 'github' | 'gitlab',
  parsed: { owner: string; repo: string; ref?: string; path?: string }
): ParsedPluginSource {
  const repoString = providerId === 'gitlab'
    ? (parsed.path ? `${parsed.owner}::${parsed.path}` : parsed.owner)
    : (parsed.path ? `${parsed.owner}/${parsed.repo}::${parsed.path}` : `${parsed.owner}/${parsed.repo}`);
  const def: PluginDefinition = { repo: repoString };
  if (parsed.ref) {
    if (/^[a-f0-9]{7,40}$/i.test(parsed.ref)) def.ref = parsed.ref;
    else if (/^v?\d+\.\d+/.test(parsed.ref)) def.version = parsed.ref;
  }
  const idHint = parsed.path
    ? basename(parsed.path)
    : (providerId === 'gitlab' ? parsed.owner.split('/').pop()! : parsed.repo);
  return {
    type: providerId,
    def,
    idHint,
  };
}

/**
 * Parse a plugin source string into a structured plugin definition.
 *
 * Accepted grammars:
 *   owner/repo                             — GitHub, plugin at repo root
 *   owner/repo::subpath/in/repo            — GitHub, plugin pinned at an exact path
 *   owner/repo@plugin-name                 — GitHub, recursive-search by basename or manifest "name"
 *   owner/repo:v1.2.0 / owner/repo#sha     — version / ref pinning (any of the forms above)
 *   gitlab:group/project[::sub|@name]     — GitLab (nested groups: ≥2 segments)
 *   https://github.com/owner/repo          — URL form
 *   https://github.com/owner/repo/tree/<ref>/<subpath>
 *   https://gitlab.com/group/.../project/-/tree/<ref>/<subpath>
 *
 * Use `::` when you know the exact subpath; use `@` when the repo hosts many
 * plugins and you'd rather match by directory basename or manifest `name`.
 *
 * @internal Exported for testing purposes
 */
export function parsePluginSource(source: string): ParsedPluginSource {
  for (const gp of getAllGitProviders()) {
    if (!gp.parseRepoUrl) continue;
    const parsed = gp.parseRepoUrl(source);
    if (!parsed) continue;
    return buildPluginSourceFromRepoUrl(gp.id as 'github' | 'gitlab', parsed);
  }

  // GitLab `@name` search: gitlab:group/sub/project@plugin-name[:version|#sha]
  const gitlabAtMatch = source.match(
    /^gitlab:([\w.-]+(?:\/[\w.-]+)+)@([\w.-]+)(?::([\w.-]+))?(?:#([a-f0-9]{7,40}))?$/i
  );
  if (gitlabAtMatch) {
    const [, repoPath, searchName, version, ref] = gitlabAtMatch;
    const def: PluginDefinition = { repo: `${repoPath}@${searchName}` };
    if (version) def.version = version;
    if (ref) def.ref = ref;
    return { type: 'gitlab', def, idHint: searchName };
  }

  // GitLab prefix (exact / root): gitlab:group/sub/project[::subpath][:version][#sha]
  const gitlabMatch = source.match(
    /^gitlab:([\w.-]+(?:\/[\w.-]+)+?)(?:::([\w./-]+?))?(?::([\w.-]+))?(?:#([a-f0-9]{7,40}))?$/i
  );
  if (gitlabMatch) {
    const [, repoPath, subpath, version, ref] = gitlabMatch;
    const def: PluginDefinition = {
      repo: subpath ? `${repoPath}::${subpath}` : repoPath,
    };
    if (version) def.version = version;
    if (ref) def.ref = ref;
    const repoSegments = repoPath.split('/');
    return {
      type: 'gitlab',
      def,
      idHint: subpath ? basename(subpath) : repoSegments[repoSegments.length - 1],
    };
  }

  // GitHub `@name` search: owner/repo@plugin-name[:version|#sha]
  // `plugin-name` must be a single segment (no slashes) — exact paths use `::`.
  const ghAtMatch = source.match(
    /^([\w.-]+\/[\w.-]+)@([\w.-]+)(?::([\w.-]+))?(?:#([a-f0-9]{7,40}))?$/i
  );
  if (ghAtMatch) {
    const [, repoPath, searchName, version, ref] = ghAtMatch;
    const def: PluginDefinition = { repo: `${repoPath}@${searchName}` };
    if (version) def.version = version;
    if (ref) def.ref = ref;
    const result: ParsedPluginSource = { type: 'github', def, idHint: searchName };
    const validation = validatePluginDef({ type: result.type, def: result.def });
    if ('error' in validation) throw new Error(validation.error);
    return result;
  }

  // GitHub shorthand (exact / root): owner/repo[::subpath][:version][#sha]
  const ghMatch = source.match(
    /^([\w.-]+\/[\w.-]+?)(?:::([\w./-]+?))?(?::([\w.-]+))?(?:#([a-f0-9]{7,40}))?$/i
  );
  if (ghMatch) {
    const [, repoPath, subpath, version, ref] = ghMatch;
    const def: PluginDefinition = {
      repo: subpath ? `${repoPath}::${subpath}` : repoPath,
    };
    if (version) def.version = version;
    if (ref) def.ref = ref;

    const result: ParsedPluginSource = {
      type: 'github',
      def,
      idHint: subpath ? basename(subpath) : repoPath.split('/')[1],
    };

    // Validate through the standard plugin validator
    const validation = validatePluginDef({ type: result.type, def: result.def });
    if ('error' in validation) {
      throw new Error(validation.error);
    }
    return result;
  }

  throw new Error(
    `Unable to parse plugin source: ${source}\n\n` +
    `Supported formats:\n` +
    `  GitHub:\n` +
    `    - Root:           owner/repo\n` +
    `    - Exact subpath:  owner/repo::plugins/my-plugin\n` +
    `    - Recursive @:    owner/repo@my-plugin  (matches a directory basename or the manifest "name" field)\n` +
    `    - URL:            https://github.com/owner/repo/tree/main/plugins/my-plugin\n` +
    `  GitLab:\n` +
    `    - Root:           gitlab:group/project\n` +
    `    - Nested groups:  gitlab:group/sub/project\n` +
    `    - Exact subpath:  gitlab:group/project::plugins/my-plugin\n` +
    `    - Recursive @:    gitlab:group/project@my-plugin\n` +
    `    - URL:            https://gitlab.com/group/project/-/tree/main/plugins/my-plugin\n\n` +
    `Pinning (any of the above):\n` +
    `  - Tag:    capa add --plugin owner/repo@my-plugin:v1.2.3\n` +
    `  - Commit: capa add --plugin owner/repo@my-plugin#abc123def\n\n` +
    `When to use which:\n` +
    `  Use "@" when the plugin's directory name (or manifest "name" field) is unique inside the repo.\n` +
    `  Use "::" for exact paths or when two plugins share a basename.`
  );
}

export async function addCommand(
  source: string,
  options: {
    plugin?: boolean;
    skill?: boolean;
    provider?: string;
    envFile?: string | boolean;
    noCache?: boolean;
  }
): Promise<void> {
  const installOpts = {
    envFile: options.envFile,
    provider: options.provider,
    noCache: options.noCache,
  };
  if (options.plugin && options.skill) {
    console.error('✗ Cannot pass both --skill and --plugin.');
    process.exit(1);
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

  // --- Registry route (runs before --plugin / --skill branches) ---
  const RESERVED_PREFIXES = /^(github|gitlab|bitbucket|npm|file|http|https):/i;
  const registryMatch = source.match(/^([a-zA-Z][\w-]*):([\s\S]+)$/);
  if (registryMatch && !RESERVED_PREFIXES.test(source) && !source.startsWith('.') && !source.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(source)) {
    const [, registryId, itemId] = registryMatch;
    const manager = new RegistryManager();
    const adapter = await manager.getAdapter(registryId);
    if (adapter) {
      console.log(`Resolving from registry "${adapter.manifest.name}"...`);

      let detail: Awaited<ReturnType<typeof manager.view>> | undefined;
      let resolvedCapability: RegistryCapability | undefined;
      for (const cap of adapter.manifest.capabilities) {
        try {
          detail = await manager.view(registryId, { capability: cap, id: itemId });
          resolvedCapability = cap;
          break;
        } catch {
          // item not found under this capability, try next
        }
      }
      if (!detail || !resolvedCapability) {
        throw new Error(
          `Item "${itemId}" not found in registry "${registryId}" under any capability ` +
          `(tried: ${adapter.manifest.capabilities.join(', ')}).`
        );
      }

      // Warn when a manual --plugin/--skill flag disagrees with the registry's verdict
      if (options.plugin && resolvedCapability !== 'plugins') {
        console.warn(`  ⚠ --plugin ignored: registry "${registryId}" resolved "${itemId}" as a ${resolvedCapability.slice(0, -1)}.`);
      }
      if (options.skill && resolvedCapability !== 'skills') {
        console.warn(`  ⚠ --skill ignored: registry "${registryId}" resolved "${itemId}" as a ${resolvedCapability.slice(0, -1)}.`);
      }

      const snippet = detail.installSnippet;
      const itemName = (snippet as any).id ?? itemId.split('/').pop() ?? 'registry-item';

      if (resolvedCapability === 'skills') {
        const existing = capabilities.skills.find(s => s.id === itemName);
        if (existing) {
          console.error(`\u2717 Skill with id "${itemName}" already exists in capabilities file.`);
          console.error(`  Rename or remove the existing entry in ${capabilitiesFile.path} and try again.`);
          process.exit(1);
        }
        const newSkill: Skill = { ...(snippet as Skill), id: itemName };
        capabilities.skills.push(newSkill);
      } else if (resolvedCapability === 'plugins') {
        if (!capabilities.plugins) capabilities.plugins = [];
        const newPlugin = snippet as Plugin;
        const existing = capabilities.plugins.find(p =>
          (p as any).id === itemName ||
          (p.type === newPlugin.type
            && p.def.repo === newPlugin.def.repo
            && (p.def.subpath ?? '') === (newPlugin.def.subpath ?? '')));
        if (existing) {
          console.error(`\u2717 Plugin "${itemName}" already exists in capabilities file.`);
          console.error(`  Rename or remove the existing entry in ${capabilitiesFile.path} and try again.`);
          process.exit(1);
        }
        capabilities.plugins.push({ ...newPlugin, id: itemName });
      }

      await writeCapabilitiesFile(capabilitiesFile.path, capabilitiesFile.format, capabilities);

      console.log(`\u2713 Added ${resolvedCapability.slice(0, -1)} "${itemName}" from registry "${registryId}" to ${capabilitiesFile.path}`);
      console.log('\n\u{1F4E6} Running installation...\n');
      await installCommand(installOpts);
      return;
    }
    // If no adapter matched, fall through to normal parsing
  }

  // --- Plugin mode (--plugin flag) ---
  if (options.plugin) {
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

    capabilities.plugins.push({ id, type: parsed.type, def: parsed.def });
    await writeCapabilitiesFile(capabilitiesFile.path, capabilitiesFile.format, capabilities);

    console.log(`✓ Added plugin "${id}" to ${capabilitiesFile.path}`);
    console.log(`  Type: ${parsed.type}`);
    console.log(`  Repo: ${parsed.def.repo}`);
    if (parsed.def.version) console.log(`  Version: ${parsed.def.version}`);
    if (parsed.def.ref) console.log(`  Ref: ${parsed.def.ref}`);

    console.log('\n📦 Running installation...\n');
    await installCommand(installOpts);
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

  capabilities.skills.push(newSkill);

  await writeCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format,
    capabilities
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

  console.log('\n📦 Running installation...\n');
  await installCommand(installOpts);
}
