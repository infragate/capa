import { resolve, basename, join, relative } from 'path';
import { access } from 'fs/promises';
import { constants } from 'fs';

export interface ParsedSkillSource {
  id: string;
  type: 'remote' | 'github' | 'gitlab' | 'local';
  def: {
    repo?: string;
    url?: string;
    path?: string;
    version?: string;
    ref?: string;
  };
}

/**
 * Parse a skill source URL/path and convert it to a skill definition.
 *
 * Repo strings accept two grammars (decided at install time by `parseRepoString`):
 *   `owner/repo@<name>`     — capa searches the cloned repo recursively for
 *                             a directory named `<name>` containing SKILL.md
 *   `owner/repo::<path>`    — exact directory path inside the repo
 * Both can be suffixed with `:version` or `#sha` for pinning.
 */
export async function parseSkillSource(source: string): Promise<ParsedSkillSource> {
  // GitHub exact-path syntax: vercel-labs/agent-skills::skills/web-researcher
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
  
  // Local path
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
