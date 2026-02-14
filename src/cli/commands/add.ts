import { detectCapabilitiesFile } from '../../shared/paths';
import { parseCapabilitiesFile, writeCapabilitiesFile } from '../../shared/capabilities';
import { installCommand } from './install';
import type { Skill } from '../../types/capabilities';
import { resolve, basename, join } from 'path';
import { readFile, access } from 'fs/promises';
import { constants } from 'fs';

interface ParsedSkillSource {
  id: string;
  type: 'inline' | 'remote' | 'github' | 'gitlab';
  def: {
    repo?: string;
    url?: string;
    content?: string;
  };
}

/**
 * Parse a skill source URL/path and convert it to a skill definition
 */
async function parseSkillSource(source: string): Promise<ParsedSkillSource> {
  // GitHub short syntax with skill name: vercel-labs/agent-skills@skill-name
  const githubAtMatch = source.match(/^([\w.-]+\/[\w.-]+)@([\w-]+)$/);
  if (githubAtMatch) {
    const [, repo, skillName] = githubAtMatch;
    return {
      id: skillName,
      type: 'github',
      def: {
        repo: `${repo}@${skillName}`
      }
    };
  }
  
  // Full GitHub URL with specific skill path
  // https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
  const githubPathMatch = source.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/tree\/[\w.-]+\/skills\/([\w-]+)/);
  if (githubPathMatch) {
    const [, repo, skillName] = githubPathMatch;
    return {
      id: skillName,
      type: 'github',
      def: {
        repo: `${repo}@${skillName}`
      }
    };
  }
  
  // GitLab prefix syntax with skill name: gitlab:group/repo@skill-name
  const gitlabAtMatch = source.match(/^gitlab:([\w.-]+\/[\w.-]+)@([\w-]+)$/);
  if (gitlabAtMatch) {
    const [, repo, skillName] = gitlabAtMatch;
    return {
      id: skillName,
      type: 'gitlab',
      def: {
        repo: `${repo}@${skillName}`
      }
    };
  }
  
  // GitLab URL with specific skill path
  // https://gitlab.com/tony.z.1711/example-skills/-/tree/main/skills/example-skill
  const gitlabPathMatch = source.match(/^https?:\/\/gitlab\.com\/([\w.-]+\/[\w.-]+)\/-\/tree\/[\w.-]+\/skills\/([\w-]+)/);
  if (gitlabPathMatch) {
    const [, repo, skillName] = gitlabPathMatch;
    return {
      id: skillName,
      type: 'gitlab',
      def: {
        repo: `${repo}@${skillName}`
      }
    };
  }
  
  // Local path: ./my-local-skills or /absolute/path
  if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/') || /^[A-Za-z]:/.test(source)) {
    const absPath = resolve(process.cwd(), source);
    const id = basename(absPath);
    
    // Try to read SKILL.md from the local path
    const skillMdPath = join(absPath, 'SKILL.md');
    let content: string;
    
    try {
      // Check if SKILL.md exists
      await access(skillMdPath, constants.R_OK);
      content = await readFile(skillMdPath, 'utf-8');
      console.log(`✓ Found SKILL.md at ${skillMdPath}`);
    } catch {
      // SKILL.md doesn't exist, generate placeholder
      console.warn(`⚠ No SKILL.md found at ${skillMdPath}, creating placeholder`);
      content = `---
name: ${id}
description: Local skill from ${source}
---

# ${id}

This is a local skill imported from: ${source}

Please update this SKILL.md file with proper documentation.
`;
    }
    
    return {
      id,
      type: 'inline',
      def: {
        content
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
  throw new Error(`Unable to parse skill source: ${source}\n\nSupported formats:\n  - GitHub with skill: owner/repo@skill-name\n  - GitHub skill URL: https://github.com/owner/repo/tree/main/skills/skill-name\n  - GitLab with skill: gitlab:owner/repo@skill-name\n  - GitLab skill URL: https://gitlab.com/owner/repo/-/tree/main/skills/skill-name\n  - Local path: ./my-local-skills (must contain SKILL.md)\n  - Remote SKILL.md URL: https://example.com/path/to/SKILL.md\n\nNote: Repository URLs require @skill-name to specify which skill to install.\nExample: capa add vercel-labs/agent-skills@web-researcher`);
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
  } else if (skillDef.def.content) {
    console.log(`  Source: inline/local`);
  }
  
  // Run install
  console.log('\n📦 Running installation...\n');
  await installCommand();
}
