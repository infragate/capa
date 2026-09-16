import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  applyInstructionContextConfig,
  newlyOwnedProviderConfig,
  removeInstructionContextConfig,
  revertInstructionContextConfig,
} from '../instruction-context-config';

describe('instruction context config (Gemini context.fileName)', () => {
  let projectPath: string;
  const settingsPath = () => join(projectPath, '.gemini', 'settings.json');
  const readSettings = () => JSON.parse(readFileSync(settingsPath(), 'utf8'));
  const writeSettings = (data: unknown) => {
    mkdirSync(join(projectPath, '.gemini'), { recursive: true });
    writeFileSync(settingsPath(), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  };

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'capa-context-config-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('adds AGENTS.md for gemini alone, keeping the GEMINI.md default, and records ownership', () => {
    const result = applyInstructionContextConfig(projectPath, ['gemini-cli'], []);
    expect(readSettings()).toEqual({ context: { fileName: ['GEMINI.md', 'AGENTS.md'] } });
    expect(result.owned).toEqual([
      {
        provider: 'gemini-cli',
        configPath: '.gemini/settings.json',
        keyPath: ['context', 'fileName'],
        values: ['AGENTS.md'],
        createdKey: true,
      },
    ]);
  });

  it('leaves settings untouched when isolated GEMINI.md is already the default', () => {
    const original = { mcpServers: { capa: { httpUrl: 'http://x' } }, context: { other: 1 } };
    writeSettings(original);
    const result = applyInstructionContextConfig(projectPath, ['codex', 'gemini-cli'], []);
    expect(readSettings()).toEqual(original);
    expect(result.owned).toEqual([]);
    expect(result.changedFiles).toEqual([]);
  });

  it('is idempotent', () => {
    const first = applyInstructionContextConfig(projectPath, ['gemini-cli'], []);
    const before = readFileSync(settingsPath(), 'utf8');
    const second = applyInstructionContextConfig(projectPath, ['gemini-cli'], first.owned);
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
    expect(second.changedFiles).toEqual([]);
    expect(second.owned).toEqual(first.owned);
  });

  it('appends to a user string value and removes only capa entries on clean', () => {
    writeSettings({ context: { fileName: 'CUSTOM.md' } });
    const { owned } = applyInstructionContextConfig(projectPath, ['codex', 'gemini-cli'], []);
    expect(readSettings().context.fileName).toEqual(['CUSTOM.md', 'GEMINI.md']);
    expect(owned[0].createdKey).toBe(false);

    const removed = removeInstructionContextConfig(projectPath, owned);
    expect(removed.owned).toEqual([]);
    expect(readSettings()).toEqual({ context: { fileName: ['CUSTOM.md'] } });
  });

  it('does not claim a value the user already listed', () => {
    writeSettings({ context: { fileName: ['AGENTS.md'] } });
    const { owned } = applyInstructionContextConfig(projectPath, ['gemini-cli'], []);
    expect(owned).toEqual([]);

    removeInstructionContextConfig(projectPath, owned);
    expect(readSettings().context.fileName).toEqual(['AGENTS.md']);
  });

  it('warns when a user-owned AGENTS.md entry defeats isolation', () => {
    writeSettings({ context: { fileName: ['GEMINI.md', 'AGENTS.md'] } });
    const result = applyInstructionContextConfig(projectPath, ['codex', 'gemini-cli'], []);
    expect(result.warnings.join('\n')).toContain('AGENTS.md');
    expect(readSettings().context.fileName).toEqual(['GEMINI.md', 'AGENTS.md']);
  });

  it('releases its own entry when the layout switches to isolated', () => {
    const shared = applyInstructionContextConfig(projectPath, ['gemini-cli'], []);
    const isolated = applyInstructionContextConfig(
      projectPath,
      ['codex', 'gemini-cli'],
      shared.owned,
    );
    // Back to the default on a key capa created, so the key is removed again.
    expect(readSettings()).toEqual({});
    expect(isolated.owned).toEqual([]);
  });

  it('releases entries when gemini is removed, deleting keys capa created', () => {
    writeSettings({ mcpServers: {} });
    const { owned } = applyInstructionContextConfig(projectPath, ['gemini-cli'], []);
    const result = applyInstructionContextConfig(projectPath, ['codex'], owned);
    expect(result.owned).toEqual([]);
    expect(readSettings()).toEqual({ mcpServers: {} });
  });

  it('never overwrites a corrupt settings file', () => {
    writeSettings('{ not json');
    const result = applyInstructionContextConfig(projectPath, ['gemini-cli'], []);
    expect(readFileSync(settingsPath(), 'utf8')).toBe('{ not json');
    expect(result.owned).toEqual([]);
    expect(result.warnings.join('\n')).toContain('not valid JSON');

    const prev = [
      {
        provider: 'gemini-cli',
        configPath: '.gemini/settings.json',
        keyPath: ['context', 'fileName'],
        values: ['AGENTS.md'],
        createdKey: true,
      },
    ];
    const removed = removeInstructionContextConfig(projectPath, prev);
    expect(removed.owned).toEqual(prev);
  });

  it('newlyOwnedProviderConfig undoes only values added since the previous record', () => {
    writeSettings({ context: { fileName: ['NOTES.md'] } });
    const before = applyInstructionContextConfig(projectPath, ['gemini-cli'], []).owned;
    const after = [{ ...before[0], values: [...before[0].values, 'EXTRA.md'] }];
    const added = newlyOwnedProviderConfig(before, after);
    expect(added).toEqual([{ ...before[0], values: ['EXTRA.md'], createdKey: false }]);

    // A fresh install's additions roll back to the original settings.
    rmSync(settingsPath());
    const fresh = applyInstructionContextConfig(projectPath, ['gemini-cli'], []).owned;
    removeInstructionContextConfig(projectPath, newlyOwnedProviderConfig([], fresh));
    expect(readSettings()).toEqual({});
  });

  it('revert restores values released by a layout switch', () => {
    writeSettings({ context: { fileName: ['NOTES.md'] } });
    const shared = applyInstructionContextConfig(projectPath, ['gemini-cli'], []).owned;
    expect(readSettings().context.fileName).toEqual(['NOTES.md', 'AGENTS.md']);

    // Switch to isolated (AGENTS.md released, GEMINI.md added), then the lockfile save fails.
    const isolated = applyInstructionContextConfig(projectPath, ['codex', 'gemini-cli'], shared).owned;
    expect(readSettings().context.fileName).toEqual(['NOTES.md', 'GEMINI.md']);

    revertInstructionContextConfig(projectPath, shared, isolated);
    expect(readSettings().context.fileName).toEqual(['NOTES.md', 'AGENTS.md']);
  });

  it('onlyProviders leaves providers outside the list untouched', () => {
    const result = applyInstructionContextConfig(projectPath, ['gemini-cli'], [], {
      onlyProviders: ['codex'],
    });
    expect(result.owned).toEqual([]);
    expect(result.changedFiles).toEqual([]);
  });

  it('skips a setting with an unexpected shape', () => {
    writeSettings({ context: { fileName: 42 } });
    const result = applyInstructionContextConfig(projectPath, ['gemini-cli'], []);
    expect(readSettings().context.fileName).toBe(42);
    expect(result.warnings.length).toBe(1);
  });
});
