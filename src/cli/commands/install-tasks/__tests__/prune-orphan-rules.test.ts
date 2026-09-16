import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pruneOrphanRulesTask } from '../prune-orphan-rules';
import type { InstallCtx } from '../context';
import type { Rule } from '../../../../types/rules';

describe('pruneOrphanRulesTask', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'capa-prune-task-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  function makeCtx(rules: Rule[], onInstallError: 'warn' | 'stop', managed: string[]): InstallCtx {
    return {
      projectPath,
      projectId: 'p',
      isWrapInstall: false,
      resolvedProviders: [],
      capabilitiesToUse: {
        providers: ['codex', 'cursor'],
        rules,
        options: { onInstallError },
      },
      installErrorMode: onInstallError,
      db: {
        getManagedFiles: () => managed,
        getManagedInstructionTargets: () => [],
        removeManagedFile: () => {},
        removeManagedInstructionTarget: () => {},
      },
      added: 0,
      failed: 0,
      warnings: [],
      errors: [],
    } as unknown as InstallCtx;
  }

  it('aborts under onInstallError: stop before deleting existing rule artifacts', async () => {
    const cursorFile = join(projectPath, '.cursor', 'rules', 'py.mdc');
    mkdirSync(join(projectPath, '.cursor', 'rules'), { recursive: true });
    writeFileSync(cursorFile, 'Py.\n');
    writeFileSync(
      join(projectPath, 'AGENTS.md'),
      '<!-- capa:start:rule:py -->\nPy.\n<!-- capa:end:rule:py -->\n',
    );
    // The rule now has a scope conflict, which is an error under `stop`.
    const rule: Rule = { id: 'py', type: 'inline', appliesTo: ['**/*.py'], content: 'Py.' };
    const ctx = makeCtx([rule], 'stop', [cursorFile]);

    await expect(pruneOrphanRulesTask().task(ctx, {} as never)).rejects.toThrow(/py/);
    expect(existsSync(cursorFile)).toBe(true);
    expect(readFileSync(join(projectPath, 'AGENTS.md'), 'utf8')).toContain('capa:start:rule:py');
  });

  it('reports warnings and still prunes in warn mode', async () => {
    writeFileSync(
      join(projectPath, 'AGENTS.md'),
      '<!-- capa:start:rule:old -->\nOld.\n<!-- capa:end:rule:old -->\n',
    );
    const rule: Rule = { id: 'py', type: 'inline', appliesTo: ['**/*.py'], content: 'Py.' };
    const ctx = makeCtx([rule], 'warn', []);

    await pruneOrphanRulesTask().task(ctx, {} as never);
    expect(ctx.warnings.join('\n')).toContain('py');
    expect(readFileSync(join(projectPath, 'AGENTS.md'), 'utf8')).not.toContain('rule:old');
  });
});
