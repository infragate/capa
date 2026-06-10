import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Rule } from '../../../types/rules';
import {
  isProviderRulesManagedPath,
  installRules,
  cleanRules,
  pruneRules,
} from '../rules-installer';

describe('rules-installer', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'capa-rules-installer-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('module loads and exports the public API', () => {
    expect(typeof isProviderRulesManagedPath).toBe('function');
    expect(typeof installRules).toBe('function');
    expect(typeof cleanRules).toBe('function');
    expect(typeof pruneRules).toBe('function');
  });

  it('isProviderRulesManagedPath recognizes cursor rule files', () => {
    const rulePath = join(projectPath, '.cursor', 'rules', 'style.mdc');
    expect(isProviderRulesManagedPath(projectPath, rulePath, ['cursor'])).toBe(true);
    expect(isProviderRulesManagedPath(projectPath, join(projectPath, 'README.md'), ['cursor'])).toBe(
      false
    );
  });

  it('installRules writes a cursor rule file and cleanRules removes it', () => {
    const rules: Rule[] = [{ id: 'style-guide', type: 'inline', content: 'Use consistent formatting.' }];
    const content = new Map([['style-guide', 'Use consistent formatting.']]);

    installRules(projectPath, rules, ['cursor'], content);

    const rulePath = join(projectPath, '.cursor', 'rules', 'style-guide.mdc');
    expect(existsSync(rulePath)).toBe(true);

    cleanRules(projectPath, ['cursor'], ['style-guide']);
    expect(existsSync(rulePath)).toBe(false);
  });

  it('installRules merges body frontmatter with capa fields, capa wins, appliesTo synonyms dropped (claude-code)', () => {
    const bodyWithCursorFm = [
      '---',
      'description: legacy cursor-style frontmatter',
      'globs: **/*.sql',
      'alwaysApply: false',
      '---',
      '',
      '# Real body',
      'do the thing',
      '',
    ].join('\n');
    const rules: Rule[] = [
      {
        id: 'with-fm',
        type: 'local',
        path: 'rules/with-fm.md',
        description: 'capa-side description',
        appliesTo: ['**/*.sql'],
      },
    ];
    const content = new Map([['with-fm', bodyWithCursorFm]]);

    installRules(projectPath, rules, ['claude-code'], content);

    const installed = readFileSync(
      join(projectPath, '.claude', 'rules', 'with-fm.md'),
      'utf8'
    );
    // Exactly one frontmatter block — the merged one.
    const fmBlocks = installed.match(/^---[\s\S]*?\n---/gm) ?? [];
    expect(fmBlocks.length).toBe(1);
    const fm = fmBlocks[0];
    // Capa's appliesTo → paths (claude-code dialect)
    expect(fm).toContain('paths:');
    // Source's `globs` is a synonym for `paths` and must be dropped
    expect(fm).not.toContain('globs:');
    // Source extras that don't collide survive
    expect(fm).toContain('alwaysApply: false');
    // claude-code's fieldMap has no `description`, so source's `description` survives
    expect(fm).toContain('description: legacy cursor-style frontmatter');
    expect(installed).toContain('# Real body');
  });

  it('installRules preserves a body with no leading frontmatter unchanged', () => {
    const plainBody = '# Plain rule\n\nno frontmatter here.\n';
    const rules: Rule[] = [
      { id: 'plain', type: 'local', path: 'rules/plain.md', appliesTo: ['**/*.ts'] },
    ];
    const content = new Map([['plain', plainBody]]);

    installRules(projectPath, rules, ['claude-code'], content);

    const installed = readFileSync(
      join(projectPath, '.claude', 'rules', 'plain.md'),
      'utf8'
    );
    expect(installed).toContain('paths:');
    expect(installed).toContain('# Plain rule');
    expect(installed).toContain('no frontmatter here.');
  });

  it('installRules preserves source frontmatter when capa would emit nothing of its own', () => {
    // claude-code with no appliesTo / alwaysApply / etc. → capa emits empty fm.
    // Source's frontmatter should reach the installed file intact.
    const bodyWithFm = '---\nkeep: me\nalso: this\n---\n\n# Body\n';
    const rules: Rule[] = [{ id: 'no-fm-fields', type: 'local', path: 'rules/x.md' }];
    const content = new Map([['no-fm-fields', bodyWithFm]]);

    installRules(projectPath, rules, ['claude-code'], content);

    const installed = readFileSync(
      join(projectPath, '.claude', 'rules', 'no-fm-fields.md'),
      'utf8'
    );
    const fmBlocks = installed.match(/^---[\s\S]*?\n---/gm) ?? [];
    expect(fmBlocks.length).toBe(1);
    expect(installed).toContain('keep: me');
    expect(installed).toContain('also: this');
  });

  it('installRules with cursor provider drops source `globs` and emits cursor-shaped frontmatter', () => {
    // Same source body, different provider — verifies appliesTo synonym collection
    // doesn't accidentally drop the provider's OWN appliesTo key name.
    const bodyWithFm = '---\ndescription: from source\nglobs: **/*.md\n---\n\nbody\n';
    const rules: Rule[] = [
      {
        id: 'cursor-rule',
        type: 'local',
        path: 'rules/cursor-rule.md',
        description: 'capa description',
        appliesTo: ['**/*.ts'],
      },
    ];
    const content = new Map([['cursor-rule', bodyWithFm]]);

    installRules(projectPath, rules, ['cursor'], content);

    const installed = readFileSync(
      join(projectPath, '.cursor', 'rules', 'cursor-rule.mdc'),
      'utf8'
    );
    // Cursor's appliesTo → globs, so capa's value must win and the *single*
    // globs entry must reference `**/*.ts` (not the source's `**/*.md`).
    expect(installed).toMatch(/globs: \*\*\/\*\.ts/);
    expect(installed).not.toMatch(/globs: \*\*\/\*\.md/);
    // Cursor's fieldMap covers description, so capa's value wins there too.
    expect(installed).toContain('description: capa description');
    expect(installed).not.toContain('description: from source');
  });

  it('pruneRules returns empty result when nothing is stale', () => {
    const rules: Rule[] = [{ id: 'kept', type: 'inline', content: 'Keep this rule.' }];
    const content = new Map([['kept', 'Keep this rule.']]);
    installRules(projectPath, rules, ['cursor'], content);

    const rulePath = join(projectPath, '.cursor', 'rules', 'kept.mdc');
    const result = pruneRules(projectPath, ['cursor'], rules, [rulePath]);

    expect(result.removedFiles).toEqual([]);
    expect(result.removedMarkers).toEqual([]);
    expect(existsSync(rulePath)).toBe(true);
  });
});
