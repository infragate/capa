import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Rule } from '../../../../types/rules';
import type { RepoSnapshotResolver } from '../../../../shared/repo-file';
import { resolveRuleBody, type ResolveRuleBodyDeps } from '../install-rules';

// The remote / github / gitlab branches of resolveRuleBody delegate to network
// helpers; the feature under test here is the `local` source, which (with
// `inline`) needs no network. These deps satisfy the type while throwing if a
// remote path is unexpectedly exercised.
function makeDeps(capabilitiesFilePath: string): ResolveRuleBodyDeps {
  const getRepoSnapshot: RepoSnapshotResolver = () => {
    throw new Error('getRepoSnapshot should not be called for local/inline rules');
  };
  return {
    capabilitiesFilePath,
    authFetch: (() => {
      throw new Error('authFetch should not be called for local/inline rules');
    }) as unknown as ResolveRuleBodyDeps['authFetch'],
    getRepoSnapshot,
  };
}

describe('resolveRuleBody', () => {
  let projectDir: string;
  let capabilitiesFilePath: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'capa-install-rules-'));
    capabilitiesFilePath = join(projectDir, 'capa.yaml');
    writeFileSync(capabilitiesFilePath, 'providers: [cursor]\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('returns inline content verbatim', async () => {
    const rule: Rule = { id: 'r', type: 'inline', content: 'Be concise.' };
    expect(await resolveRuleBody(rule, makeDeps(capabilitiesFilePath))).toBe('Be concise.');
  });

  it('reads a local file resolved relative to the capabilities file directory', async () => {
    mkdirSync(join(projectDir, 'rules'), { recursive: true });
    writeFileSync(join(projectDir, 'rules', 'typescript.md'), '# TS conventions\nUse strict mode.\n', 'utf-8');

    const rule: Rule = {
      id: 'typescript-conventions',
      type: 'local',
      path: 'rules/typescript.md',
    };

    const body = await resolveRuleBody(rule, makeDeps(capabilitiesFilePath));
    expect(body).toBe('# TS conventions\nUse strict mode.\n');
  });

  it('resolves local paths relative to the capabilities file, not the process cwd', async () => {
    // Capabilities file lives in a nested dir; a bare relative path must resolve
    // against that dir.
    const nestedDir = join(projectDir, 'config');
    mkdirSync(nestedDir, { recursive: true });
    const nestedCapFile = join(nestedDir, 'capa.yaml');
    writeFileSync(nestedCapFile, 'providers: [cursor]\n', 'utf-8');
    writeFileSync(join(nestedDir, 'rule.md'), 'nested body', 'utf-8');

    const rule: Rule = { id: 'r', type: 'local', path: 'rule.md' };
    expect(await resolveRuleBody(rule, makeDeps(nestedCapFile))).toBe('nested body');
  });

  it('throws when a local rule has no path', async () => {
    const rule: Rule = { id: 'r', type: 'local' };
    await expect(resolveRuleBody(rule, makeDeps(capabilitiesFilePath))).rejects.toThrow(
      /is type 'local' but has no path/
    );
  });

  it('throws a descriptive error when the local file does not exist', async () => {
    const rule: Rule = { id: 'r', type: 'local', path: 'rules/missing.md' };
    await expect(resolveRuleBody(rule, makeDeps(capabilitiesFilePath))).rejects.toThrow(
      /local file not found/
    );
  });

  it('throws when inline content is missing', async () => {
    const rule: Rule = { id: 'r', type: 'inline' };
    await expect(resolveRuleBody(rule, makeDeps(capabilitiesFilePath))).rejects.toThrow(
      /is type 'inline' but has no content/
    );
  });

  it('throws on an unknown rule type', async () => {
    const rule = { id: 'r', type: 'mystery' } as unknown as Rule;
    await expect(resolveRuleBody(rule, makeDeps(capabilitiesFilePath))).rejects.toThrow(
      /Unknown rule type: mystery/
    );
  });
});
