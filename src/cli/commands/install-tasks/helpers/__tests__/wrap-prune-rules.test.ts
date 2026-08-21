import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CapaDatabase } from '../../../../../db/database';
import { getProvider } from '../../../../../shared/providers';
import { pruneRules } from '../../../../utils/rules-installer';

describe('pruneRules wrap shadow scope', () => {
  let realDir: string;
  let shadowDir: string;
  let db: CapaDatabase;
  const projectId = 'proj-wrap-rules';

  beforeEach(() => {
    realDir = mkdtempSync(join(tmpdir(), 'capa-wrap-rules-real-'));
    shadowDir = mkdtempSync(join(tmpdir(), 'capa-wrap-rules-shadow-'));
    db = new CapaDatabase(':memory:');
    db.upsertProject({ id: projectId, path: realDir });
  });

  afterEach(() => {
    rmSync(realDir, { recursive: true, force: true });
    rmSync(shadowDir, { recursive: true, force: true });
    db.close();
  });

  it('removes orphan rules under the shadow workspace only', () => {
    const provider = getProvider('claude-code')!;
    const shadowRuleDir = join(shadowDir, provider.rules!.dir);
    mkdirSync(shadowRuleDir, { recursive: true });
    const shadowRule = join(shadowRuleDir, `old-rule${provider.rules!.extension}`);
    writeFileSync(shadowRule, 'stale');
    db.addManagedFile(projectId, shadowRule);

    const realRuleDir = join(realDir, provider.rules!.dir);
    mkdirSync(realRuleDir, { recursive: true });
    const realRule = join(realRuleDir, `keep-real${provider.rules!.extension}`);
    writeFileSync(realRule, 'real project rule');
    db.addManagedFile(projectId, realRule);

    const { removedFiles } = pruneRules(
      shadowDir,
      ['claude-code'],
      [],
      db.getManagedFiles(projectId),
    );

    expect(removedFiles).toContain(shadowRule);
    expect(existsSync(shadowRule)).toBe(false);
    expect(existsSync(realRule)).toBe(true);
  });
});
