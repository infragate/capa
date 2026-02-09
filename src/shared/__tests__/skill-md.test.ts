import { describe, it, expect } from 'bun:test';
import { parseSkillMd, generateSkillMd, createSkillTemplate } from '../skill-md';

describe('skill-md', () => {
  describe('parseSkillMd', () => {
    it('should parse valid SKILL.md with frontmatter', () => {
      const content = `---
name: test-skill
description: A test skill
---

# Test Skill

This is the body.`;

      const result = parseSkillMd(content);
      
      expect(result.metadata.name).toBe('test-skill');
      expect(result.metadata.description).toBe('A test skill');
      expect(result.body).toContain('# Test Skill');
    });

    it('should throw error for missing frontmatter', () => {
      const content = 'No frontmatter here';
      
      expect(() => parseSkillMd(content)).toThrow('missing frontmatter');
    });

    it('should throw error for missing name in frontmatter', () => {
      const content = `---
description: A test skill
---

Body content`;
      
      expect(() => parseSkillMd(content)).toThrow('missing "name"');
    });

    it('should handle multiple metadata fields', () => {
      const content = `---
name: test-skill
description: A test skill
author: John Doe
version: 1.0.0
---

Body content`;

      const result = parseSkillMd(content);
      
      expect(result.metadata.name).toBe('test-skill');
      expect(result.metadata.description).toBe('A test skill');
      expect(result.metadata.author).toBe('John Doe');
      expect(result.metadata.version).toBe('1.0.0');
    });

    it('should trim whitespace from body', () => {
      const content = `---
name: test-skill
---


Body with extra whitespace


`;

      const result = parseSkillMd(content);
      
      expect(result.body).toBe('Body with extra whitespace');
    });
  });

  describe('generateSkillMd', () => {
    it('should generate valid SKILL.md format', () => {
      const metadata = {
        name: 'test-skill',
        description: 'A test skill',
      };
      const body = 'This is the body';
      
      const result = generateSkillMd(metadata, body);
      
      expect(result).toContain('---');
      expect(result).toContain('name: test-skill');
      expect(result).toContain('description: A test skill');
      expect(result).toContain('This is the body');
    });

    it('should handle metadata with multiple fields', () => {
      const metadata = {
        name: 'test-skill',
        description: 'A test skill',
        author: 'John Doe',
        version: '1.0.0',
      };
      const body = 'Body content';
      
      const result = generateSkillMd(metadata, body);
      
      expect(result).toContain('name: test-skill');
      expect(result).toContain('author: John Doe');
      expect(result).toContain('version: 1.0.0');
    });

    it('should be reversible with parseSkillMd', () => {
      const metadata = {
        name: 'test-skill',
        description: 'A test skill',
      };
      const body = 'This is the body';
      
      const generated = generateSkillMd(metadata, body);
      const parsed = parseSkillMd(generated);
      
      expect(parsed.metadata.name).toBe(metadata.name);
      expect(parsed.metadata.description).toBe(metadata.description);
      expect(parsed.body).toBe(body);
    });
  });

  describe('createSkillTemplate', () => {
    it('should create template with name only', () => {
      const template = createSkillTemplate('my-skill');
      
      expect(template).toContain('name: my-skill');
      expect(template).toContain('# my-skill');
      expect(template).toContain('## Usage');
      expect(template).toContain('## Examples');
    });

    it('should create template with name and description', () => {
      const template = createSkillTemplate('my-skill', 'Does something cool');
      
      expect(template).toContain('name: my-skill');
      expect(template).toContain('description: Does something cool');
      expect(template).toContain('# my-skill');
      expect(template).toContain('Does something cool');
    });

    it('should generate valid parseable template', () => {
      const template = createSkillTemplate('my-skill', 'Test description');
      
      expect(() => parseSkillMd(template)).not.toThrow();
      
      const parsed = parseSkillMd(template);
      expect(parsed.metadata.name).toBe('my-skill');
      expect(parsed.metadata.description).toBe('Test description');
    });
  });
});
