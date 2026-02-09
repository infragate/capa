import { detectCapabilitiesFile } from '../../shared/paths';
import { parseCapabilitiesFile, writeCapabilitiesFile } from '../../shared/capabilities';
import { installCommand } from './install';
import type { Skill } from '../../types/capabilities';
import { resolve, basename } from 'path';

interface ParsedSkillSource {
  id: string;
  type: 'inline' | 'remote' | 'github';
  def: {
    repo?: string;
    url?: string;
    content?: string;
  };
}

/**
 * Parse a skill source URL/path and convert it to a skill definition
 */
function parseSkillSource(source: string): ParsedSkillSource {
  // GitHub short syntax: vercel-labs/agent-skills
  if (/^[\w-]+\/[\w.-]+$/.test(source)) {
    return {
      id: extractIdFromGithubRepo(source),
      type: 'github',
      def: {
        repo: `${source}@${extractIdFromGithubRepo(source)}`
      }
    };
  }
  
  // Full GitHub URL with specific skill path
  // https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
  const githubPathMatch = source.match(/^https?:\/\/github\.com\/([\w-]+\/[\w.-]+)\/tree\/[\w.-]+\/skills\/([\w-]+)/);
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
  
  // Full GitHub URL (repo root): https://github.com/vercel-labs/agent-skills
  const githubMatch = source.match(/^https?:\/\/github\.com\/([\w-]+\/[\w.-]+?)(?:\.git)?$/);
  if (githubMatch) {
    const repo = githubMatch[1];
    return {
      id: extractIdFromGithubRepo(repo),
      type: 'github',
      def: {
        repo: `${repo}@${extractIdFromGithubRepo(repo)}`
      }
    };
  }
  
  // GitLab URL: https://gitlab.com/org/repo
  const gitlabMatch = source.match(/^https?:\/\/gitlab\.com\/([\w-]+\/[\w.-]+)/);
  if (gitlabMatch) {
    const repo = gitlabMatch[1];
    const id = extractIdFromGithubRepo(repo); // Same logic works for GitLab
    return {
      id,
      type: 'remote',
      def: {
        url: `https://gitlab.com/${repo}/-/raw/main/SKILL.md`
      }
    };
  }
  
  // Git SSH URL: git@github.com:vercel-labs/agent-skills.git
  const gitSshMatch = source.match(/^git@([\w.]+):([\w-]+\/[\w.-]+?)(?:\.git)?$/);
  if (gitSshMatch) {
    const [, host, repo] = gitSshMatch;
    const id = extractIdFromGithubRepo(repo);
    
    if (host === 'github.com') {
      return {
        id,
        type: 'github',
        def: {
          repo: `${repo}@${id}`
        }
      };
    } else {
      // For non-GitHub git hosts, use raw URL approach
      return {
        id,
        type: 'remote',
        def: {
          url: `https://${host}/${repo}/-/raw/main/SKILL.md`
        }
      };
    }
  }
  
  // Local path: ./my-local-skills or /absolute/path
  if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/') || /^[A-Za-z]:/.test(source)) {
    const absPath = resolve(process.cwd(), source);
    const id = basename(absPath);
    
    return {
      id,
      type: 'inline',
      def: {
        content: `---
name: ${id}
description: Local skill from ${source}
---

# ${id}

This is a local skill imported from: ${source}

Please update this SKILL.md file with proper documentation.
`
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
  throw new Error(`Unable to parse skill source: ${source}\n\nSupported formats:\n  - GitHub short: vercel-labs/agent-skills\n  - GitHub URL: https://github.com/vercel-labs/agent-skills\n  - GitHub skill path: https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines\n  - GitLab URL: https://gitlab.com/org/repo\n  - Git SSH: git@github.com:vercel-labs/agent-skills.git\n  - Local path: ./my-local-skills\n  - Remote URL: https://example.com/SKILL.md`);
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
  const capabilitiesFile = detectCapabilitiesFile(projectPath);
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
    skillDef = parseSkillSource(source);
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
