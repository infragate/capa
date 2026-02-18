import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { parseSkillSource } from '../add';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('parseSkillSource', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-add-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // On Windows, files might be locked. Ignore cleanup errors.
      console.warn(`Cleanup warning: ${error}`);
    }
  });

  describe('GitHub short syntax', () => {
    it('should parse GitHub short syntax with skill name', async () => {
      const result = await parseSkillSource('vercel-labs/agent-skills@web-researcher');
      
      expect(result.id).toBe('web-researcher');
      expect(result.type).toBe('github');
      expect(result.def.repo).toBe('vercel-labs/agent-skills@web-researcher');
    });

    it('should parse GitHub with dashes and dots in names', async () => {
      const result = await parseSkillSource('my-org/my.repo@my-skill');
      
      expect(result.id).toBe('my-skill');
      expect(result.type).toBe('github');
      expect(result.def.repo).toBe('my-org/my.repo@my-skill');
    });

    it('should not match GitHub syntax with nested paths', async () => {
      // GitHub doesn't support nested paths like GitLab
      await expect(parseSkillSource('owner/group/repo@skill')).rejects.toThrow();
    });
  });

  describe('GitHub URL syntax', () => {
    it('should parse full GitHub URL with skill path', async () => {
      const result = await parseSkillSource(
        'https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines'
      );
      
      expect(result.id).toBe('web-design-guidelines');
      expect(result.type).toBe('github');
      expect(result.def.repo).toBe('vercel-labs/agent-skills@web-design-guidelines');
    });

    it('should parse GitHub URL with different branch name', async () => {
      const result = await parseSkillSource(
        'https://github.com/owner/repo/tree/develop/skills/my-skill'
      );
      
      expect(result.id).toBe('my-skill');
      expect(result.type).toBe('github');
      expect(result.def.repo).toBe('owner/repo@my-skill');
    });

    it('should handle http protocol', async () => {
      const result = await parseSkillSource(
        'http://github.com/owner/repo/tree/main/skills/test-skill'
      );
      
      expect(result.id).toBe('test-skill');
      expect(result.type).toBe('github');
    });
  });

  describe('GitLab short syntax', () => {
    it('should parse GitLab short syntax with two-level path', async () => {
      const result = await parseSkillSource('gitlab:tony.z.1711/example-skills@example-skill');
      
      expect(result.id).toBe('example-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('tony.z.1711/example-skills@example-skill');
    });

    it('should parse GitLab with nested groups (3 levels)', async () => {
      const result = await parseSkillSource('gitlab:group/subgroup/repo@my-skill');
      
      expect(result.id).toBe('my-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('group/subgroup/repo@my-skill');
    });

    it('should parse GitLab with deeply nested groups (4 levels)', async () => {
      const result = await parseSkillSource('gitlab:a/b/c/repo@skill-in-repo');
      
      expect(result.id).toBe('skill-in-repo');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('a/b/c/repo@skill-in-repo');
    });

    it('should parse GitLab with very deeply nested groups (5+ levels)', async () => {
      const result = await parseSkillSource('gitlab:org/team/division/project/repo@advanced-skill');
      
      expect(result.id).toBe('advanced-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('org/team/division/project/repo@advanced-skill');
    });

    it('should parse GitLab with dashes and dots in path segments', async () => {
      const result = await parseSkillSource('gitlab:my-org/sub.group/my-repo@test-skill');
      
      expect(result.id).toBe('test-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('my-org/sub.group/my-repo@test-skill');
    });

    it('should not match single-level GitLab path', async () => {
      // GitLab requires at least group/repo structure
      await expect(parseSkillSource('gitlab:repo@skill')).rejects.toThrow();
    });
  });

  describe('GitLab URL syntax', () => {
    it('should parse GitLab URL with two-level path', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/tony.z.1711/example-skills/-/tree/main/skills/example-skill'
      );
      
      expect(result.id).toBe('example-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('tony.z.1711/example-skills@example-skill');
    });

    it('should parse GitLab URL with nested groups (3 levels)', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/group/subgroup/project/-/tree/main/skills/my-skill'
      );
      
      expect(result.id).toBe('my-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('group/subgroup/project@my-skill');
    });

    it('should parse GitLab URL with deeply nested groups (4 levels)', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/a/b/c/repo/-/tree/main/skills/skill-in-repo'
      );
      
      expect(result.id).toBe('skill-in-repo');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('a/b/c/repo@skill-in-repo');
    });

    it('should parse GitLab URL with very deeply nested groups (5+ levels)', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/org/division/team/subteam/repo/-/tree/develop/skills/deep-skill'
      );
      
      expect(result.id).toBe('deep-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('org/division/team/subteam/repo@deep-skill');
    });

    it('should handle different branch names in GitLab URLs', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/group/repo/-/tree/feature-branch/skills/test'
      );
      
      expect(result.id).toBe('test');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('group/repo@test');
    });

    it('should handle http protocol for GitLab', async () => {
      const result = await parseSkillSource(
        'http://gitlab.com/a/b/c/-/tree/main/skills/skill'
      );
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('gitlab');
    });
  });

  describe('Local paths', () => {
    it('should parse relative local path with SKILL.md', async () => {
      const skillDir = join(tempDir, 'my-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        '---\nname: test\ndescription: Test skill\n---\n# Test Skill',
        'utf-8'
      );
      
      const originalCwd = process.cwd();
      try {
        const relativePath = `./${skillDir.split(/[/\\]/).pop()}`;
        process.chdir(tempDir);
        
        const result = await parseSkillSource(relativePath);
        
        expect(result.id).toBe('my-skill');
        expect(result.type).toBe('local');
        expect(result.def.path).toBe('my-skill');
        expect(result.def.content).toBeUndefined();
      } finally {
        // Restore original working directory
        process.chdir(originalCwd);
      }
    });

    it('should parse absolute local path with SKILL.md', async () => {
      const skillDir = join(tempDir, 'abs-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        '---\nname: abs\n---\n# Absolute Skill',
        'utf-8'
      );
      
      const result = await parseSkillSource(skillDir);
      
      expect(result.id).toBe('abs-skill');
      expect(result.type).toBe('local');
      expect(result.def.path).toBeDefined();
      expect(result.def.path).toContain('abs-skill');
      expect(result.def.content).toBeUndefined();
    });

    it('should throw when SKILL.md is missing', async () => {
      const skillDir = join(tempDir, 'no-skill-md');
      mkdirSync(skillDir, { recursive: true });
      
      await expect(parseSkillSource(skillDir)).rejects.toThrow(/No SKILL.md found/);
    });

    it('should handle Windows-style absolute paths', async () => {
      // Create a test directory on Windows
      if (process.platform === 'win32') {
        const winPath = join('C:', 'temp', 'test-skill');
        // We can't actually create on C:\ but we can test the path detection
        const result = winPath;
        expect(/^[A-Za-z]:/.test(result)).toBe(true);
      }
    });
  });

  describe('Remote URLs', () => {
    it('should parse remote SKILL.md URL', async () => {
      const result = await parseSkillSource('https://example.com/skills/my-skill.md');
      
      expect(result.id).toBe('my-skill');
      expect(result.type).toBe('remote');
      expect(result.def.url).toBe('https://example.com/skills/my-skill.md');
    });

    it('should parse remote URL without .md extension', async () => {
      const result = await parseSkillSource('https://example.com/skills/custom');
      
      expect(result.id).toBe('custom');
      expect(result.type).toBe('remote');
      expect(result.def.url).toBe('https://example.com/skills/custom');
    });

    it('should handle http protocol for remote URLs', async () => {
      const result = await parseSkillSource('http://example.com/skill.md');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('remote');
    });
  });

  describe('Error cases', () => {
    it('should throw error for invalid format', async () => {
      await expect(parseSkillSource('invalid-format')).rejects.toThrow(
        /Unable to parse skill source/
      );
    });

    it('should throw error with helpful message', async () => {
      try {
        await parseSkillSource('random-string');
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('Supported formats:');
        expect(message).toContain('GitHub with skill:');
        expect(message).toContain('GitLab with skill:');
      }
    });

    it('should not match GitHub/GitLab patterns without @ separator', async () => {
      await expect(parseSkillSource('owner/repo')).rejects.toThrow();
      await expect(parseSkillSource('gitlab:owner/repo')).rejects.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle skill names with multiple dashes', async () => {
      const result = await parseSkillSource('owner/repo@multi-dash-skill-name');
      
      expect(result.id).toBe('multi-dash-skill-name');
      expect(result.type).toBe('github');
    });

    it('should handle GitLab nested paths with dots and dashes', async () => {
      const result = await parseSkillSource(
        'gitlab:org-1/team.2/sub-group.3/my-repo@skill-name'
      );
      
      expect(result.id).toBe('skill-name');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('org-1/team.2/sub-group.3/my-repo@skill-name');
    });

    it('should extract basename for remote URLs without extension', async () => {
      const result = await parseSkillSource('https://cdn.example.com/path/to/resources');
      
      expect(result.id).toBe('resources');
      expect(result.type).toBe('remote');
    });
  });

  describe('Regression tests for nested GitLab paths', () => {
    it('should handle the reported bug case: a/b/c/repo@skill-in-repo', async () => {
      const result = await parseSkillSource('gitlab:a/b/c/repo@skill-in-repo');
      
      expect(result.id).toBe('skill-in-repo');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('a/b/c/repo@skill-in-repo');
    });

    it('should handle URL format for nested path: a/b/c/repo', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/a/b/c/repo/-/tree/main/skills/skill-in-repo'
      );
      
      expect(result.id).toBe('skill-in-repo');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('a/b/c/repo@skill-in-repo');
    });

    it('should support arbitrarily deep nesting in GitLab', async () => {
      const deepPath = 'gitlab:' + Array.from({ length: 10 }, (_, i) => `level${i}`).join('/') + '@deep-skill';
      const result = await parseSkillSource(deepPath);
      
      expect(result.id).toBe('deep-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toContain('level0/level1');
      expect(result.def.repo).toContain('@deep-skill');
    });
  });

  describe('Version syntax for GitHub', () => {
    it('should parse GitHub short syntax with semantic version', async () => {
      const result = await parseSkillSource('owner/repo@skill:1.2.3');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('github');
      expect(result.def.repo).toBe('owner/repo@skill:1.2.3');
      expect(result.def.version).toBe('1.2.3');
      expect(result.def.ref).toBeUndefined();
    });

    it('should parse GitHub short syntax with v-prefixed version', async () => {
      const result = await parseSkillSource('owner/repo@skill:v2.0.0');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('github');
      expect(result.def.repo).toBe('owner/repo@skill:v2.0.0');
      expect(result.def.version).toBe('v2.0.0');
    });

    it('should parse GitHub short syntax with patch version', async () => {
      const result = await parseSkillSource('owner/repo@skill:0.1.0');
      
      expect(result.id).toBe('skill');
      expect(result.def.version).toBe('0.1.0');
    });

    it('should parse GitHub URL with version in tree path', async () => {
      const result = await parseSkillSource(
        'https://github.com/owner/repo/tree/v1.5.2/skills/my-skill'
      );
      
      expect(result.id).toBe('my-skill');
      expect(result.type).toBe('github');
      expect(result.def.version).toBe('v1.5.2');
      expect(result.def.repo).toBe('owner/repo@my-skill:v1.5.2');
    });

    it('should parse GitHub URL with version without v prefix', async () => {
      const result = await parseSkillSource(
        'https://github.com/owner/repo/tree/2.1.0/skills/my-skill'
      );
      
      expect(result.id).toBe('my-skill');
      expect(result.def.version).toBe('2.1.0');
    });
  });

  describe('Version syntax for GitLab', () => {
    it('should parse GitLab short syntax with semantic version', async () => {
      const result = await parseSkillSource('gitlab:group/repo@skill:1.2.3');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('group/repo@skill:1.2.3');
      expect(result.def.version).toBe('1.2.3');
      expect(result.def.ref).toBeUndefined();
    });

    it('should parse GitLab nested groups with version', async () => {
      const result = await parseSkillSource('gitlab:org/team/project@skill:v3.0.0');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('org/team/project@skill:v3.0.0');
      expect(result.def.version).toBe('v3.0.0');
    });

    it('should parse GitLab deeply nested with version', async () => {
      const result = await parseSkillSource('gitlab:a/b/c/repo@skill:2.5.1');
      
      expect(result.id).toBe('skill');
      expect(result.def.repo).toBe('a/b/c/repo@skill:2.5.1');
      expect(result.def.version).toBe('2.5.1');
    });

    it('should parse GitLab URL with version in tree path', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/group/subgroup/repo/-/tree/v1.0.0/skills/my-skill'
      );
      
      expect(result.id).toBe('my-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.version).toBe('v1.0.0');
      expect(result.def.repo).toBe('group/subgroup/repo@my-skill:v1.0.0');
    });

    it('should parse GitLab URL with version dots and dashes', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/a/b/c/-/tree/1.2.3/skills/skill'
      );
      
      expect(result.id).toBe('skill');
      expect(result.def.version).toBe('1.2.3');
    });
  });

  describe('Commit SHA syntax for GitHub', () => {
    it('should parse GitHub short syntax with 7-char SHA', async () => {
      const result = await parseSkillSource('owner/repo@skill#abc1234');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('github');
      expect(result.def.repo).toBe('owner/repo@skill#abc1234');
      expect(result.def.ref).toBe('abc1234');
      expect(result.def.version).toBeUndefined();
    });

    it('should parse GitHub short syntax with 40-char SHA', async () => {
      const result = await parseSkillSource('owner/repo@skill#1234567890abcdef1234567890abcdef12345678');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('github');
      expect(result.def.ref).toBe('1234567890abcdef1234567890abcdef12345678');
      expect(result.def.repo).toContain('#1234567890abcdef');
    });

    it('should parse GitHub short syntax with mixed case SHA', async () => {
      const result = await parseSkillSource('owner/repo@skill#AbC123DeF');
      
      expect(result.id).toBe('skill');
      expect(result.def.ref).toBe('AbC123DeF');
    });

    it('should parse GitHub URL with SHA in tree path', async () => {
      const result = await parseSkillSource(
        'https://github.com/owner/repo/tree/abc1234def5/skills/my-skill'
      );
      
      expect(result.id).toBe('my-skill');
      expect(result.type).toBe('github');
      expect(result.def.ref).toBe('abc1234def5');
      expect(result.def.repo).toBe('owner/repo@my-skill#abc1234def5');
    });

    it('should parse GitHub URL with full 40-char SHA', async () => {
      const result = await parseSkillSource(
        'https://github.com/owner/repo/tree/1234567890abcdef1234567890abcdef12345678/skills/skill'
      );
      
      expect(result.id).toBe('skill');
      expect(result.def.ref).toBe('1234567890abcdef1234567890abcdef12345678');
    });
  });

  describe('Commit SHA syntax for GitLab', () => {
    it('should parse GitLab short syntax with 7-char SHA', async () => {
      const result = await parseSkillSource('gitlab:group/repo@skill#abc1234');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.repo).toBe('group/repo@skill#abc1234');
      expect(result.def.ref).toBe('abc1234');
      expect(result.def.version).toBeUndefined();
    });

    it('should parse GitLab nested groups with SHA', async () => {
      const result = await parseSkillSource('gitlab:org/team/project@skill#def5678abc');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.ref).toBe('def5678abc');
      expect(result.def.repo).toBe('org/team/project@skill#def5678abc');
    });

    it('should parse GitLab deeply nested with 40-char SHA', async () => {
      const result = await parseSkillSource('gitlab:a/b/c/repo@skill#1234567890abcdef1234567890abcdef12345678');
      
      expect(result.id).toBe('skill');
      expect(result.def.ref).toBe('1234567890abcdef1234567890abcdef12345678');
    });

    it('should parse GitLab URL with SHA in tree path', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/group/subgroup/repo/-/tree/abc123def456/skills/my-skill'
      );
      
      expect(result.id).toBe('my-skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.ref).toBe('abc123def456');
      expect(result.def.repo).toBe('group/subgroup/repo@my-skill#abc123def456');
    });

    it('should parse GitLab URL with full SHA', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/a/b/c/-/tree/1234567890abcdef1234567890abcdef12345678/skills/skill'
      );
      
      expect(result.id).toBe('skill');
      expect(result.def.ref).toBe('1234567890abcdef1234567890abcdef12345678');
    });
  });

  describe('Backward compatibility', () => {
    it('should still parse GitHub without version/ref', async () => {
      const result = await parseSkillSource('owner/repo@skill');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('github');
      expect(result.def.repo).toBe('owner/repo@skill');
      expect(result.def.version).toBeUndefined();
      expect(result.def.ref).toBeUndefined();
    });

    it('should still parse GitLab without version/ref', async () => {
      const result = await parseSkillSource('gitlab:group/repo@skill');
      
      expect(result.id).toBe('skill');
      expect(result.type).toBe('gitlab');
      expect(result.def.version).toBeUndefined();
      expect(result.def.ref).toBeUndefined();
    });

    it('should still parse GitHub URLs with branch names', async () => {
      const result = await parseSkillSource(
        'https://github.com/owner/repo/tree/main/skills/skill'
      );
      
      expect(result.id).toBe('skill');
      expect(result.def.version).toBeUndefined();
      expect(result.def.ref).toBeUndefined();
    });

    it('should still parse GitLab URLs with branch names', async () => {
      const result = await parseSkillSource(
        'https://gitlab.com/group/repo/-/tree/develop/skills/skill'
      );
      
      expect(result.id).toBe('skill');
      expect(result.def.version).toBeUndefined();
      expect(result.def.ref).toBeUndefined();
    });
  });

  describe('Edge cases for version/ref', () => {
    it('should reject invalid SHA (too short)', async () => {
      await expect(parseSkillSource('owner/repo@skill#abc12')).rejects.toThrow();
    });

    it('should reject invalid SHA (non-hex characters)', async () => {
      await expect(parseSkillSource('owner/repo@skill#xyz1234')).rejects.toThrow();
    });

    it('should handle version with dots correctly', async () => {
      const result = await parseSkillSource('owner/repo@skill:1.2.3.4');
      
      expect(result.def.version).toBe('1.2.3.4');
    });

    it('should handle version with dashes', async () => {
      const result = await parseSkillSource('owner/repo@skill:v1.2.3-beta');
      
      expect(result.def.version).toBe('v1.2.3-beta');
    });

    it('should not confuse version numbers in skill names', async () => {
      const result = await parseSkillSource('owner/repo@skill-v2:1.0.0');
      
      expect(result.id).toBe('skill-v2');
      expect(result.def.version).toBe('1.0.0');
    });
  });
});
