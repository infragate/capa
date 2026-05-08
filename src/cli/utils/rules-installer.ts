import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import type { Rule } from '../../types/rules';
import { getProvider } from '../../shared/providers';
import { buildRuleFrontmatter } from '../../shared/providers/handlers';

const RULE_MARKER_PREFIX = 'rule:';

function ruleMarkerId(ruleId: string): string {
  return `${RULE_MARKER_PREFIX}${ruleId}`;
}

// ---------------------------------------------------------------------------
// YAML frontmatter builder
// ---------------------------------------------------------------------------

function buildYamlFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 1) {
        lines.push(`${key}: ${value[0]}`);
      } else {
        lines.push(`${key}:`);
        for (const v of value) {
          lines.push(`  - ${v}`);
        }
      }
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Capa marker-block helpers (self-contained to avoid circular imports)
// ---------------------------------------------------------------------------

const MARKER_START = (id: string) => `<!-- capa:start:${id} -->`;
const MARKER_END = (id: string) => `<!-- capa:end:${id} -->`;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markerBlockRe(id: string): RegExp {
  return new RegExp(
    `${escapeRegex(MARKER_START(id))}[\\s\\S]*?${escapeRegex(MARKER_END(id))}`,
    'g'
  );
}

function buildBlock(id: string, body: string): string {
  return `${MARKER_START(id)}\n${body.trimEnd()}\n${MARKER_END(id)}`;
}

function upsertBlock(content: string, id: string, body: string): string {
  const block = buildBlock(id, body);
  if (markerBlockRe(id).test(content)) {
    return content.replace(markerBlockRe(id), block);
  }
  const base = content.trimEnd();
  return base.length > 0 ? `${base}\n\n${block}\n` : `${block}\n`;
}

function removeBlock(content: string, id: string): string {
  return content.replace(markerBlockRe(id), '').replace(/\n{3,}/g, '\n\n');
}

function listMarkerIds(content: string): string[] {
  const ids: string[] = [];
  const re = /<!-- capa:start:([^>]+?) -->/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function readMd(projectPath: string, filename: string): string {
  const filePath = join(projectPath, filename);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function writeMd(projectPath: string, filename: string, content: string): void {
  const dir = dirname(join(projectPath, filename));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(projectPath, filename), content, 'utf8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install rules for all active providers.
 *
 * For providers with a `rules` integration (e.g. Cursor `.cursor/rules/*.mdc`):
 *   writes each rule as a separate file with optional YAML frontmatter.
 *
 * For providers without a `rules` integration but with `instructions`:
 *   folds each rule into the instructions file as a capa marker block.
 *
 * @param resolvedContent - Map from rule.id to the already-fetched rule body text.
 */
export function installRules(
  projectPath: string,
  rules: Rule[],
  providers: string[],
  resolvedContent: Map<string, string>
): void {
  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider) continue;

    const applicableRules = rules.filter((r) => {
      if (!r.providers || r.providers.length === 0) return true;
      return r.providers.includes(pid);
    });

    if (applicableRules.length === 0) continue;

    if (provider.rules) {
      const rulesDir = join(projectPath, provider.rules.dir);
      mkdirSync(rulesDir, { recursive: true });

      for (const rule of applicableRules) {
        const content = resolvedContent.get(rule.id);
        if (!content) continue;

        let fileContent = '';
        if (provider.rules.frontmatter === 'yaml' && provider.rules.fieldMap) {
          const fm = buildRuleFrontmatter(provider.rules, rule);
          if (Object.keys(fm).length > 0) {
            fileContent = buildYamlFrontmatter(fm) + '\n';
          }
        }
        fileContent += content;
        if (!fileContent.endsWith('\n')) fileContent += '\n';

        const filePath = join(rulesDir, `${rule.id}${provider.rules.extension}`);
        writeFileSync(filePath, fileContent, 'utf-8');
        console.log(`  ✓ ${provider.rules.dir}/${rule.id}${provider.rules.extension} written (${provider.displayName})`);
      }
    } else if (provider.instructions) {
      const filename = provider.instructions.filename;
      let mdContent = readMd(projectPath, filename);

      for (const rule of applicableRules) {
        const content = resolvedContent.get(rule.id);
        if (!content) continue;
        mdContent = upsertBlock(mdContent, ruleMarkerId(rule.id), content);
      }

      writeMd(projectPath, filename, mdContent);
      console.log(`  ✓ ${filename} updated with ${applicableRules.length} rule(s) (${provider.displayName})`);
    }
  }
}

/**
 * Remove capa-managed rule files and rule marker blocks for all providers.
 *
 * @param ruleIds - IDs of rules to remove. When provided, only files matching
 *   `{ruleId}{extension}` are deleted. When omitted / empty, nothing is deleted
 *   from directory-based providers (avoiding accidental removal of user-authored files).
 */
export function cleanRules(projectPath: string, providers: string[], ruleIds?: string[]): void {
  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider) continue;

    if (provider.rules) {
      const rulesDir = join(projectPath, provider.rules.dir);
      if (!existsSync(rulesDir)) continue;

      const managedNames = new Set(
        (ruleIds ?? []).map((id) => `${id}${provider.rules!.extension}`)
      );
      const files = readdirSync(rulesDir)
        .filter((f) => f.endsWith(provider.rules!.extension))
        .filter((f) => managedNames.size === 0 ? false : managedNames.has(f));
      for (const file of files) {
        unlinkSync(join(rulesDir, file));
      }
      if (files.length > 0) {
        console.log(`  ✓ Removed ${files.length} rule file(s) from ${provider.rules.dir} (${provider.displayName})`);
      }
    }

    if (provider.instructions) {
      const filename = provider.instructions.filename;
      let mdContent = readMd(projectPath, filename);
      if (!mdContent) continue;

      const ids = listMarkerIds(mdContent);
      const ruleIds = ids.filter((id) => id.startsWith(RULE_MARKER_PREFIX));
      if (ruleIds.length === 0) continue;

      for (const id of ruleIds) {
        mdContent = removeBlock(mdContent, id);
      }
      writeMd(projectPath, filename, mdContent);
      console.log(`  ✓ Removed ${ruleIds.length} rule marker(s) from ${filename} (${provider.displayName})`);
    }
  }
}
