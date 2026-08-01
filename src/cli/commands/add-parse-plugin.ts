import { basename } from 'path';
import type { PluginDefinition } from '../../types/plugin';
import { validatePluginDef } from '../../shared/plugin-source';
import { getAllGitProviders } from '../../shared/git-providers/registry';

export interface ParsedPluginSource {
  type: 'github' | 'gitlab';
  def: PluginDefinition;
  idHint: string;
}

export function buildPluginSourceFromRepoUrl(
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
