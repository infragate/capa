/**
 * Utilities for working with SKILL.md files (compatible with skills.sh)
 */

export interface SkillMetadata {
  name: string;
  description?: string;
  [key: string]: any;
}

/**
 * Parse SKILL.md frontmatter and content
 */
export function parseSkillMd(content: string): { metadata: SkillMetadata; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    throw new Error('Invalid SKILL.md format: missing frontmatter');
  }
  
  const [, frontmatter, body] = match;
  const metadata: SkillMetadata = { name: '' };
  
  // Parse YAML-style frontmatter (simple key: value pairs)
  for (const line of frontmatter.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    metadata[key] = value;
  }
  
  if (!metadata.name) {
    throw new Error('Invalid SKILL.md format: missing "name" in frontmatter');
  }
  
  return { metadata, body: body.trim() };
}

/**
 * Generate SKILL.md content from metadata and body
 */
export function generateSkillMd(metadata: SkillMetadata, body: string): string {
  const frontmatterLines = Object.entries(metadata)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  
  return `---\n${frontmatterLines}\n---\n\n${body}`;
}

/**
 * Create a basic SKILL.md template
 */
export function createSkillTemplate(name: string, description?: string): string {
  const metadata: SkillMetadata = {
    name,
    ...(description && { description }),
  };
  
  const body = `# ${name}

${description || 'Describe what this skill does here.'}

## Usage

Explain when and how to use this skill.

## Examples

Provide examples of using this skill.
`;
  
  return generateSkillMd(metadata, body);
}
