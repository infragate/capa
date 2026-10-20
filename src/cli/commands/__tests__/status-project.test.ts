import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../../db/database';
import { computeInstallFingerprint } from '../../../shared/install-fingerprint';
import { generateProjectId } from '../../../shared/paths';
import { VERSION } from '../../../version';
import { resetSecretCryptoForTests } from '../../../shared/secret-crypto';
import { collectProjectReport } from '../status';
import { redactUrlSecrets } from '../install';
import { runTasks } from '../../ui';

const CAPS = `providers: [claude-code]
skills:
  - id: hello
    type: inline
    def: { content: hi }
servers:
  - id: api
    type: mcp
    def:
      url: https://example.com/mcp
      headers: { Authorization: "Bearer \${API_TOKEN}" }
`;

describe('capa status: project report (#332)', () => {
  let dir: string;
  let projectPath: string;
  let dbPath: string;
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capa-status-'));
    // Secrets are encrypted with a master key: keep it in the temp home.
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.env.CAPA_SECRET_STORE = 'file';
    resetSecretCryptoForTests();
    projectPath = join(dir, 'proj');
    dbPath = join(dir, 'capa.db');
    require('fs').mkdirSync(projectPath);
  });

  afterEach(() => {
    resetSecretCryptoForTests();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env.CAPA_SECRET_STORE;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  /** Simulate a finished `capa install`. */
  async function install(outcome: Partial<{ completed: boolean; failed: number; errors: string[]; version: string }> = {}) {
    const db = new CapaDatabase(dbPath);
    const id = generateProjectId(projectPath);
    db.upsertProject({ id, path: projectPath });
    db.setProjectProviders(id, ['claude-code']);
    db.setProjectInstallState(id, {
      fingerprint: (await computeInstallFingerprint(projectPath))!,
      capaVersion: outcome.version ?? VERSION,
      installedAt: Date.now(),
      completed: outcome.completed ?? true,
      failed: outcome.failed ?? 0,
      errors: outcome.errors ?? [],
      // As install records them: merged capabilities, plugin items included.
      counts: { skills: 7, plugins: 1, servers: 2, hooks: 0 },
    });
    return { db, id };
  }

  it('reports a folder without a capabilities file as not initialized', async () => {
    const report = await collectProjectReport(projectPath, dbPath);
    expect(report.state).toBe('not-initialized');
  });

  it('reports a project that was never installed', async () => {
    writeFileSync(join(projectPath, 'capabilities.yaml'), CAPS);
    const report = await collectProjectReport(projectPath, dbPath);
    expect(report.state).toBe('not-installed');
    expect(report.counts).toEqual({ skills: 1, plugins: 0, servers: 1, hooks: 0 });
  });

  it('tells a project installed by an older capa from one never installed', async () => {
    writeFileSync(join(projectPath, 'capabilities.yaml'), CAPS);
    const db = new CapaDatabase(dbPath);
    const id = generateProjectId(projectPath);
    db.upsertProject({ id, path: projectPath }); // capa init does this much
    db.close();
    expect((await collectProjectReport(projectPath, dbPath)).state).toBe('not-installed');

    const db2 = new CapaDatabase(dbPath);
    db2.setProjectProviders(id, ['cursor']); // only capa install records providers
    db2.close();
    const report = await collectProjectReport(projectPath, dbPath);
    expect(report.state).toBe('out-of-date');
    expect(report.reasons[0]).toContain('older capa');
  });

  it('reports an installed project and its missing variables', async () => {
    writeFileSync(join(projectPath, 'capabilities.yaml'), CAPS);
    const { db, id } = await install();
    db.close();
    let report = await collectProjectReport(projectPath, dbPath);
    expect(report.state).toBe('installed');
    expect(report.providers).toEqual(['claude-code']);
    expect(report.counts).toEqual({ skills: 7, plugins: 1, servers: 2, hooks: 0 });
    expect(report.problems).toEqual(['Variables without a value: API_TOKEN.']);

    const db2 = new CapaDatabase(dbPath);
    db2.setVariable(id, 'API_TOKEN', 'x');
    db2.close();
    report = await collectProjectReport(projectPath, dbPath);
    expect(report.problems).toEqual([]);
  });

  it('reports out of date after an edit, a lockfile change or a capa upgrade', async () => {
    writeFileSync(join(projectPath, 'capabilities.yaml'), CAPS);
    (await install()).db.close();

    // Line-ending changes alone are not an edit.
    writeFileSync(join(projectPath, 'capabilities.yaml'), CAPS.replace(/\n/g, '\r\n'));
    expect((await collectProjectReport(projectPath, dbPath)).state).toBe('installed');

    writeFileSync(join(projectPath, 'capabilities.yaml'), `${CAPS}hooks: []\n`);
    let report = await collectProjectReport(projectPath, dbPath);
    expect(report.state).toBe('out-of-date');
    expect(report.reasons).toEqual(['The capabilities file changed since the last install.']);

    writeFileSync(join(projectPath, 'capabilities.yaml'), CAPS);
    (await install({ version: '0.0.1' })).db.close();
    report = await collectProjectReport(projectPath, dbPath);
    expect(report.state).toBe('out-of-date');
    expect(report.reasons).toEqual([`Installed with capa 0.0.1; this is capa ${VERSION}.`]);
  });

  it('reports the failures of the last install', async () => {
    writeFileSync(join(projectPath, 'capabilities.yaml'), CAPS.replace(/\s+headers:.*\n/, '\n'));
    (await install({ completed: false, failed: 1, errors: ['Plugin "x" failed to resolve'] })).db.close();
    const report = await collectProjectReport(projectPath, dbPath);
    expect(report.state).toBe('installed');
    expect(report.problems).toEqual([
      'The last install stopped before finishing.',
      'Plugin "x" failed to resolve',
    ]);
  });

  it('only reads: no ~/.capa, no settings, no secret migration', async () => {
    writeFileSync(join(projectPath, 'capabilities.yaml'), CAPS);
    // No database yet: nothing is created to find that out.
    await collectProjectReport(projectPath);
    expect(require('fs').existsSync(join(dir, '.capa'))).toBe(false);

    const { db, id } = await install();
    db.close();
    // A legacy plaintext secret stays as it is (CapaDatabase would encrypt it).
    const raw = new (require('bun:sqlite').Database)(dbPath);
    raw.run('INSERT INTO variables (project_id, key, value, created_at) VALUES (?, ?, ?, ?)', [id, 'API_TOKEN', 'plain', Date.now()]);
    raw.close();
    const report = await collectProjectReport(projectPath, dbPath);
    expect(report.problems).toEqual([]);
    const check = new (require('bun:sqlite').Database)(dbPath, { readonly: true });
    const row = check.query('SELECT value FROM variables WHERE key = ?').get('API_TOKEN') as { value: string };
    check.close();
    expect(row.value).toBe('plain');
  });

  it('reports an ambiguous capabilities file as a problem instead of failing', async () => {
    writeFileSync(join(projectPath, 'capabilities.yaml'), CAPS);
    writeFileSync(join(projectPath, 'capabilities.json'), '{}');
    const report = await collectProjectReport(projectPath, dbPath);
    expect(report.problems[0]).toContain('ambiguous');
  });
});

describe('install records for status', () => {
  it('redacts URL credentials and query strings', () => {
    expect(
      redactUrlSecrets('Failed to fetch https://user:tok3n@example.com/skill.md?token=abc&x=1: got HTML'),
    ).toBe('Failed to fetch https://example.com/skill.md?<redacted>: got HTML');
    expect(redactUrlSecrets('plain message')).toBe('plain message');
  });

  it('reports a task that crashed when not stopping on errors', async () => {
    const seen: string[] = [];
    await runTasks(
      [
        { title: 'Boom', task: async () => { throw new Error('crashed'); } },
        { title: 'After', task: async () => { seen.push('after ran'); } },
      ],
      { exitOnError: false, onError: (title, err) => seen.push(`${title}: ${(err as Error).message}`) },
      {},
    );
    expect(seen).toEqual(['Boom: crashed', 'after ran']);
  });
});
