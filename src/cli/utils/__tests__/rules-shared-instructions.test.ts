import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Rule } from '../../../types/rules';
import { cleanRules, installRules, pruneRules } from '../rules-installer';
import { cleanAgentsFile, installAgentsFile } from '../agents-file/index';

/**
 * Providers sharing AGENTS.md (issue #193): provider-targeted rules, nested
 * scope, isolated GEMINI.md, and order-independent prune.
 */
describe('rules in shared instruction files', () => {
  let projectPath: string;
  const read = (rel: string) => readFileSync(join(projectPath, rel), 'utf8');
  const exists = (rel: string) => existsSync(join(projectPath, rel));

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'capa-rules-shared-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  function sync(rules: Rule[], providers: string[], tracked: string[] = []) {
    const bodies = new Map(rules.map((r) => [r.id, r.content ?? '']));
    const prune = pruneRules(projectPath, providers, rules, [], {
      trackedInstructionTargets: tracked,
    });
    const written: string[] = [];
    const install = installRules(projectPath, rules, providers, bodies, {
      onInstructionTargetWritten: (f) => written.push(f),
    });
    const next = [...new Set([...tracked, ...written])].filter(
      (f) => !prune.removedInstructionTargets.includes(f),
    );
    return { prune, install, tracked: next };
  }

  it('keeps a codex-only rule out of the file gemini reads', () => {
    const rules: Rule[] = [
      { id: 'codex-only', type: 'inline', providers: ['codex'], content: 'Codex rule.' },
      { id: 'shared', type: 'inline', content: 'Shared rule.' },
    ];
    const { install } = sync(rules, ['codex', 'gemini-cli']);

    expect(read('AGENTS.md')).toContain('Codex rule.');
    expect(read('AGENTS.md')).toContain('Shared rule.');
    expect(read('GEMINI.md')).not.toContain('Codex rule.');
    expect(read('GEMINI.md')).toContain('Shared rule.');
    expect(install.diagnostics).toEqual([]);
  });

  it('produces identical files regardless of provider order, and re-running is a no-op', () => {
    const rules: Rule[] = [
      { id: 'codex-only', type: 'inline', providers: ['codex'], content: 'C' },
      { id: 'gemini-only', type: 'inline', providers: ['gemini-cli'], content: 'G' },
    ];
    sync(rules, ['codex', 'gemini-cli']);
    const agents = read('AGENTS.md');
    const gemini = read('GEMINI.md');

    sync(rules, ['gemini-cli', 'codex']);
    expect(read('AGENTS.md')).toBe(agents);
    expect(read('GEMINI.md')).toBe(gemini);

    const again = sync(rules, ['codex', 'gemini-cli']);
    expect(again.prune.removedMarkers).toEqual([]);
    expect(read('AGENTS.md')).toBe(agents);
  });

  it('moves gemini back to AGENTS.md and deletes GEMINI.md when codex is removed', () => {
    const rules: Rule[] = [{ id: 'all', type: 'inline', content: 'All.' }];
    let state = sync(rules, ['codex', 'gemini-cli']);
    expect(exists('GEMINI.md')).toBe(true);

    state = sync(rules, ['gemini-cli'], state.tracked);
    expect(exists('GEMINI.md')).toBe(false);
    expect(read('AGENTS.md')).toContain('All.');
    expect(state.tracked).toEqual([]);
  });

  it('writes directory-scoped rules to nested files and prunes them when scope changes', () => {
    mkdirSync(join(projectPath, 'src'));
    const scoped: Rule = { id: 'src-rule', type: 'inline', appliesTo: ['src/**'], content: 'Src.' };
    let state = sync([scoped], ['codex']);

    expect(read('src/AGENTS.md')).toContain('Src.');
    expect(exists('AGENTS.md')).toBe(false);
    expect(state.tracked).toEqual([join(projectPath, 'src', 'AGENTS.md')]);

    const widened: Rule = { ...scoped, appliesTo: ['**/*.py'], scope: 'best-effort' };
    state = sync([widened], ['codex'], state.tracked);
    expect(exists('src/AGENTS.md')).toBe(false);
    expect(read('AGENTS.md')).toContain('> Applies to: `**/*.py`');
    expect(state.tracked).toEqual([]);
  });

  it('keeps user content in a nested file and only removes capa blocks', () => {
    mkdirSync(join(projectPath, 'src'));
    writeFileSync(join(projectPath, 'src', 'AGENTS.md'), '# Team notes\n');
    const scoped: Rule = { id: 'src-rule', type: 'inline', appliesTo: ['src/**'], content: 'Src.' };
    const state = sync([scoped], ['codex']);
    expect(read('src/AGENTS.md')).toContain('# Team notes');
    expect(read('src/AGENTS.md')).toContain('Src.');

    cleanRules(projectPath, ['codex'], ['src-rule'], { trackedInstructionTargets: state.tracked });
    expect(read('src/AGENTS.md').trim()).toBe('# Team notes');
  });

  it('skips nested targets whose directory does not exist', () => {
    const scoped: Rule = { id: 'missing', type: 'inline', appliesTo: ['nope/**'], content: 'X' };
    const { install } = sync([scoped], ['codex']);
    expect(exists('nope/AGENTS.md')).toBe(false);
    expect(install.warnings.join('\n')).toContain('nope');
  });

  it('reports a conflict and skips the rule under conflicts: error', () => {
    const rules: Rule[] = [{ id: 'codex-only', type: 'inline', providers: ['codex'], content: 'C' }];
    const bodies = new Map([['codex-only', 'C']]);
    const prune = pruneRules(projectPath, ['codex', 'cursor'], rules, [], { conflicts: 'error' });
    installRules(projectPath, rules, ['codex', 'cursor'], bodies, { conflicts: 'error' });

    expect(prune.diagnostics.map((d) => [d.code, d.level])).toEqual([['visibility-conflict', 'error']]);
    expect(exists('AGENTS.md')).toBe(false);
  });

  it('reports written instruction files and unique skipped rules', () => {
    const rules: Rule[] = [
      { id: 'codex-only', type: 'inline', providers: ['codex'], appliesTo: ['**/*.py'], content: 'C' },
      { id: 'gemini-only', type: 'inline', providers: ['gemini-cli'], content: 'G' },
    ];
    const bodies = new Map(rules.map((r) => [r.id, r.content!]));
    const result = installRules(projectPath, rules, ['codex', 'gemini-cli', 'cursor'], bodies, {
      conflicts: 'error',
    });
    // codex-only has two error diagnostics (scope + visibility) but is one skipped rule.
    expect(result.diagnostics.filter((d) => d.ruleId === 'codex-only').length).toBe(2);
    expect(result.skippedRuleIds).toEqual(['codex-only']);
    expect(result.writtenInstructionFiles).toEqual(['GEMINI.md']);
    expect(result.installedRuleIds).toEqual(['gemini-only']);
  });

  it('does not count a rule for inactive providers as installed', () => {
    const rules: Rule[] = [{ id: 'cursor-only', type: 'inline', providers: ['cursor'], content: 'C' }];
    const result = installRules(projectPath, rules, ['codex'], new Map([['cursor-only', 'C']]));
    expect(result.installedRuleIds).toEqual([]);
    expect(result.skippedRuleIds).toEqual([]);
  });

  it('skips an error-conflict rule for native rules directories too', () => {
    const rule: Rule = { id: 'py', type: 'inline', appliesTo: ['**/*.py'], content: 'Py.' };
    const bodies = new Map([['py', 'Py.']]);
    const cursorFile = join(projectPath, '.cursor', 'rules', 'py.mdc');

    // Installed earlier when Cursor was the only provider.
    installRules(projectPath, [rule], ['cursor'], bodies);
    expect(existsSync(cursorFile)).toBe(true);

    const prune = pruneRules(projectPath, ['codex', 'cursor'], [rule], [cursorFile], {
      conflicts: 'error',
    });
    const install = installRules(projectPath, [rule], ['codex', 'cursor'], bodies, {
      conflicts: 'error',
    });

    expect(prune.diagnostics.map((d) => d.level)).toEqual(['error']);
    expect(install.diagnostics.map((d) => d.level)).toEqual(['error']);
    expect(existsSync(cursorFile)).toBe(false);
    expect(exists('AGENTS.md')).toBe(false);
  });

  it('delivers a rule once to cursor when codex folds it into AGENTS.md (#260)', () => {
    mkdirSync(join(projectPath, 'services'));
    const rules: Rule[] = [
      { id: 'all', type: 'inline', content: 'All.' },
      { id: 'svc', type: 'inline', appliesTo: ['services/**'], content: 'Svc.' },
    ];
    const { install } = sync(rules, ['codex', 'cursor']);

    expect(read('AGENTS.md')).toContain('All.');
    expect(read('services/AGENTS.md')).toContain('Svc.');
    expect(exists('.cursor/rules/all.mdc')).toBe(false);
    expect(exists('.cursor/rules/svc.mdc')).toBe(false);
    expect(install.diagnostics).toEqual([]);
  });

  it('warns when codex best-effort fold widens cursor scope, even under best-effort (#260)', () => {
    const rule: Rule = {
      id: 'py',
      type: 'inline',
      appliesTo: ['**/*.py'],
      scope: 'best-effort',
      content: 'Py.',
    };
    const { install } = sync([rule], ['codex', 'cursor']);

    expect(read('AGENTS.md')).toContain('Py.');
    expect(exists('.cursor/rules/py.mdc')).toBe(false);
    expect(install.diagnostics.map((d) => [d.code, d.level])).toEqual([['scope-widened', 'warn']]);
  });

  it('keeps the native cursor rule when codex does not receive the rule', () => {
    const rule: Rule = { id: 'cur', type: 'inline', providers: ['cursor'], content: 'Cur.' };
    sync([rule], ['codex', 'cursor']);

    expect(exists('.cursor/rules/cur.mdc')).toBe(true);
    expect(exists('AGENTS.md')).toBe(false);
  });

  it('prunes a now-duplicate native cursor rule when codex is added', () => {
    const rule: Rule = { id: 'all', type: 'inline', content: 'All.' };
    const bodies = new Map([['all', 'All.']]);
    const cursorFile = join(projectPath, '.cursor', 'rules', 'all.mdc');
    installRules(projectPath, [rule], ['cursor'], bodies);
    expect(existsSync(cursorFile)).toBe(true);

    const prune = pruneRules(projectPath, ['codex', 'cursor'], [rule], [cursorFile]);
    installRules(projectPath, [rule], ['codex', 'cursor'], bodies);

    expect(prune.removedFiles).toEqual([cursorFile]);
    expect(existsSync(cursorFile)).toBe(false);
    expect(read('AGENTS.md')).toContain('All.');
  });

  it('cleanRules finds nested targets from the rules when the DB has no record', () => {
    mkdirSync(join(projectPath, 'src'));
    const scoped: Rule = { id: 'src-rule', type: 'inline', appliesTo: ['src/**'], content: 'Src.' };
    sync([scoped], ['codex']);

    cleanRules(projectPath, ['codex'], ['src-rule'], { rules: [scoped] });
    expect(exists('src/AGENTS.md')).toBe(false);
  });

  it('writes agent snippets to GEMINI.md only while gemini is isolated', async () => {
    const config = { additional: [{ id: 'team', type: 'inline' as const, content: 'Team snippet.' }] };
    await installAgentsFile(projectPath, config, ['codex', 'gemini-cli']);
    expect(read('AGENTS.md')).toContain('Team snippet.');
    expect(read('GEMINI.md')).toContain('Team snippet.');

    await installAgentsFile(projectPath, config, ['gemini-cli']);
    expect(exists('GEMINI.md')).toBe(false);
    expect(read('AGENTS.md')).toContain('Team snippet.');
  });

  it('re-installing snippets after rules leaves the file unchanged', async () => {
    const config = { additional: [{ id: 'team', type: 'inline' as const, content: 'Team snippet.' }] };
    const rules: Rule[] = [{ id: 'style', type: 'inline', content: 'Style rule.' }];
    // Install order: snippets, then rules (same as the install pipeline).
    await installAgentsFile(projectPath, config, ['codex']);
    sync(rules, ['codex']);
    const first = read('AGENTS.md');

    await installAgentsFile(projectPath, config, ['codex']);
    sync(rules, ['codex']);
    expect(read('AGENTS.md')).toBe(first);
    expect(first.startsWith('<!-- capa:start:team -->')).toBe(true);
  });

  it('cleanAgentsFile removes an isolated GEMINI.md', async () => {
    const config = { additional: [{ id: 'team', type: 'inline' as const, content: 'Team snippet.' }] };
    await installAgentsFile(projectPath, config, ['codex', 'gemini-cli']);
    cleanAgentsFile(projectPath, ['codex', 'gemini-cli']);
    expect(exists('GEMINI.md')).toBe(false);
    expect(exists('AGENTS.md')).toBe(false);
  });
});
