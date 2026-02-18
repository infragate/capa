import { detectCapabilitiesFile } from '../../shared/paths';
import { parseCapabilitiesFile, writeCapabilitiesFile } from '../../shared/capabilities';
import { installCommand } from './install';
import type { Skill } from '../../types/capabilities';
import { resolve, basename, join, relative } from 'path';
import { readFile, access } from 'fs/promises';
import { constants } from 'fs';

interface ParsedSkillSource {
  id: string;
  type: 'inline' | 'remote' | 'github' | 'gitlab' | 'local';
  def: {
    repo?: string;
    url?: string;
    content?: string;
    path?: string;     // For local skills: path to directory containing SKILL.md
    version?: string;  // Tag or version like "1.2.1" or "v1.2.1"
    ref?: string;      // Commit SHA
  };
}

/**
 * Parse a skill source URL/path and convert it to a skill definition
 * @internal Exported for testing purposes
 */
export async function parseSkillSource(source: string): Promise<ParsedSkillSource> {
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
  throw new Error(`Unable to parse skill source: ${source}\n\nSupported formats:\n  - GitHub with skill: owner/repo@skill-name\n  - GitHub with version: owner/repo@skill-name:1.2.1\n  - GitHub with commit: owner/repo@skill-name#abc123\n  - GitHub skill URL: https://github.com/owner/repo/tree/main/skills/skill-name\n  - GitLab with skill: gitlab:owner/repo@skill-name\n  - GitLab with version: gitlab:owner/repo@skill-name:1.2.1\n  - GitLab with commit: gitlab:owner/repo@skill-name#abc123\n  - GitLab skill URL: https://gitlab.com/owner/repo/-/tree/main/skills/skill-name\n  - Local path: ./my-local-skills (directory containing SKILL.md)\n  - Remote SKILL.md URL: https://example.com/path/to/SKILL.md\n\nVersion/commit examples:\n  - Pin to version: capa add owner/repo@skill:v1.2.3\n  - Pin to commit: capa add gitlab:group/repo@skill#abc123def\n  - Latest (default): capa add owner/repo@skill`);
}

/**
 * Extract a skill ID from a GitHub repository path
 */
function extractIdFromGithubRepo(repo: string): string {
  const parts = repo.split('/');
  return parts[parts.length - 1].replace(/\.git$/, '');
}

export async function addCommand(source: string, options: { id?: string }): Promise<void> {
  const projectPath = process.cwd();
  
  // Detect capabilities file
  const capabilitiesFile = await detectCapabilitiesFile(projectPath);
  if (!capabilitiesFile) {
    console.error('✗ No capabilities file found. Run "capa init" first.');
    process.exit(1);
  }
  
  console.log(`Using ${capabilitiesFile.path}`);
  
  // Parse capabilities file
  const capabilities = await parseCapabilitiesFile(
    capabilitiesFile.path,
    capabilitiesFile.format
  );
  
  // Parse the skill source
  let skillDef: ParsedSkillSource;
  try {
    skillDef = await parseSkillSource(source);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  
  // Allow custom ID override
  if (options.id) {
    skillDef.id = options.id;
  }
  
  // Check if skill already exists
  const existingSkill = capabilities.skills.find(s => s.id === skillDef.id);
  if (existingSkill) {
    console.error(`✗ Skill with id "${skillDef.id}" already exists in capabilities file.`);
    console.error('  Use a different ID with --id <name> or remove the existing skill first.');
    process.exit(1);
  }
  
  // Add skill to capabilities
  const newSkill: Skill = {
    id: skillDef.id,
    type: skillDef.type,
    def: skillDef.def
  };
  
  capabilities.skills.push(newSkill);
  
  // Write updated capabilities file
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
  } else if (skillDef.def.content) {
    console.log(`  Source: inline`);
  }
  
  // Run install
  console.log('\n📦 Running installation...\n');
  await installCommand();
}
