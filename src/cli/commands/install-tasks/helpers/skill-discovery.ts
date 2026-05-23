import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { getAllProviders } from '../../../../shared/providers';
import { parseSkillMd } from '../../../../shared/skill-md';
import { forEachSkillFile } from '../../../../shared/skill-copy';

// Recursively find all SKILL.md files in a directory. Each skill is indexed
// by its directory basename AND by the `name` field from the SKILL.md
// frontmatter (if it differs from the dirname).
export function findSkillsInDirectory(dir: string): Map<string, string> {
  const skills = new Map<string, string>();
  const providerHiddenDirs = new Set(
    getAllProviders()
      .map((p) => dirname(p.skillsDir) || p.skillsDir)
      .filter((d) => d.startsWith('.'))
  );

  function searchDir(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.name.startsWith('.') && !providerHiddenDirs.has(entry.name)) {
          continue;
        }
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }

        if (entry.isDirectory()) {
          const skillMdPath = join(fullPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            skills.set(entry.name, skillMdPath);

            try {
              const content = readFileSync(skillMdPath, 'utf-8');
              const { metadata } = parseSkillMd(content);
              if (metadata.name && metadata.name !== entry.name) {
                skills.set(metadata.name, skillMdPath);
              }
            } catch {
              // Frontmatter parse failed — directory name is still indexed
            }
          }

          searchDir(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  searchDir(dir);
  return skills;
}

// Read a skill and its additional files from a directory.
export function readSkillFromDirectory(skillMdPath: string): {
  markdown: string;
  additionalFiles: Map<string, string>;
} {
  const markdown = readFileSync(skillMdPath, 'utf-8');
  const skillDir = dirname(skillMdPath);
  const additionalFiles = new Map<string, string>();

  try {
    forEachSkillFile(skillDir, ({ relPath, srcPath }) => {
      const normalized = relPath.replace(/\\/g, '/');
      if (normalized === 'SKILL.md') return;
      try {
        additionalFiles.set(normalized, readFileSync(srcPath, 'utf-8'));
      } catch {
        // Can't read file, skip
      }
    });
  } catch {
    // Can't read directory, skip
  }

  return { markdown, additionalFiles };
}
