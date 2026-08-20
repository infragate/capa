import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateAndRepairShadowWorkspace } from '../validate-shadow-workspace';
import { LOCKFILE_NAME } from '../../../../shared/lockfile';

const CURSOR_ONLY = ['cursor'];

describe('validateAndRepairShadowWorkspace', () => {
  let realDir: string;
  let wsDir: string;

  beforeEach(() => {
    realDir = mkdtempSync(join(tmpdir(), 'capa-wrap-real-'));
    wsDir = mkdtempSync(join(tmpdir(), 'capa-wrap-ws-'));
    mkdirSync(join(realDir, 'src'));
    writeFileSync(join(realDir, 'src', 'a.ts'), 'export {}');
    writeFileSync(join(realDir, 'capabilities.yaml'), 'skills: []\n');
    writeFileSync(join(realDir, LOCKFILE_NAME), 'version: 1\nskills: []\nplugins: []\n');
    mkdirSync(join(realDir, '.cursor'));
    writeFileSync(join(realDir, '.cursor', 'mcp.json'), '{}');
  });

  afterEach(() => {
    rmSync(realDir, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  });

  it('symlinks new top-level files from the real project', () => {
    writeFileSync(join(realDir, 'NEW.md'), 'hello');
    const result = validateAndRepairShadowWorkspace(realDir, wsDir, CURSOR_ONLY);
    expect(result.needsReinstall).toBe(true);
    expect(existsSync(join(wsDir, 'NEW.md'))).toBe(true);
  });

  it('removes provider dirs that symlink to the real project', () => {
    symlinkSync(join(realDir, '.cursor'), join(wsDir, '.cursor'));
    const result = validateAndRepairShadowWorkspace(realDir, wsDir, CURSOR_ONLY);
    expect(result.repaired).toContain('.cursor');
    expect(result.needsReinstall).toBe(true);
    expect(existsSync(join(wsDir, '.cursor'))).toBe(false);
  });

  it('removes nested provider install symlinks', () => {
    mkdirSync(join(wsDir, '.cursor'), { recursive: true });
    symlinkSync(join(realDir, 'src'), join(wsDir, '.cursor', 'skills'));
    const result = validateAndRepairShadowWorkspace(realDir, wsDir, CURSOR_ONLY);
    expect(result.repaired).toContain('.cursor/skills');
    expect(result.needsReinstall).toBe(true);
    expect(existsSync(join(wsDir, '.cursor', 'skills'))).toBe(false);
  });

  it('leaves materialized provider dirs intact', () => {
    mkdirSync(join(wsDir, '.cursor', 'skills', 'demo'), { recursive: true });
    writeFileSync(join(wsDir, '.cursor', 'skills', 'demo', 'SKILL.md'), '# demo');
    writeFileSync(join(wsDir, '.cursor', 'mcp.json'), '{}');
    writeFileSync(join(wsDir, 'AGENTS.md'), '# agents');
    const result = validateAndRepairShadowWorkspace(realDir, wsDir, CURSOR_ONLY);
    expect(result.repaired).toEqual([]);
    expect(result.needsReinstall).toBe(false);
    expect(lstatSync(join(wsDir, '.cursor')).isSymbolicLink()).toBe(false);
  });
});
