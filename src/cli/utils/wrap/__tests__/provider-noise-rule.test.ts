import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  WRAP_PROVIDER_NOISE_RULE_ID,
  buildWrapProviderNoiseRuleBody,
  installWrapProviderNoiseRule,
} from '../provider-noise-rule';

describe('provider-noise-rule', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'capa-wrap-noise-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('lists owned top-level paths for exclusion providers', () => {
    const body = buildWrapProviderNoiseRuleBody(['cursor', 'claude-code']);
    expect(body).toContain('shadow workspace');
    expect(body).toContain('`.cursor`');
    expect(body).toContain('`.claude`');
    expect(body).toContain('`AGENTS.md`');
    expect(body).toContain('`CLAUDE.md`');
  });

  it('installs an always-apply cursor rule', () => {
    installWrapProviderNoiseRule(projectPath, 'cursor', ['cursor']);
    const rulePath = join(projectPath, '.cursor', 'rules', `${WRAP_PROVIDER_NOISE_RULE_ID}.mdc`);
    expect(existsSync(rulePath)).toBe(true);
    const text = readFileSync(rulePath, 'utf8');
    expect(text).toContain('alwaysApply: true');
    expect(text).toContain('.cursor');
    expect(text).toContain('version control');
  });
});
