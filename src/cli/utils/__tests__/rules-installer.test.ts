import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
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
