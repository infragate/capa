import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildSymlinkWorkspace } from '../symlink-workspace';
import { startWrapWatchers } from '../watch-project';
import { LOCKFILE_NAME } from '../../../../shared/lockfile';

const CURSOR_ONLY = ['cursor'];

describe('watch-project', () => {
  let realDir: string;
  let wsDir: string;
  let capsPath: string;

  beforeEach(() => {
    realDir = mkdtempSync(join(tmpdir(), 'capa-watch-real-'));
    wsDir = mkdtempSync(join(tmpdir(), 'capa-watch-ws-'));
    writeFileSync(join(realDir, 'capabilities.yaml'), 'skills: []\nproviders: [cursor]\n');
    writeFileSync(join(realDir, LOCKFILE_NAME), 'version: 1\nskills: []\nplugins: []\n');
    mkdirSync(join(realDir, 'src'));
    writeFileSync(join(realDir, 'src', 'a.ts'), 'export {}');
    capsPath = join(realDir, 'capabilities.yaml');
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_ONLY);
  });

  afterEach(() => {
    rmSync(realDir, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  });

  it('exitSweep promotes workspace-only top-level files into the real project', () => {
    const watchers = startWrapWatchers({
      realProjectPath: realDir,
      workspacePath: wsDir,
      providerId: 'cursor',
      capabilitiesPath: capsPath,
      exclusionProviderIds: CURSOR_ONLY,
    });

    writeFileSync(join(wsDir, 'NEW_FROM_AGENT.md'), 'hello from shadow\n');
    watchers.exitSweep();
    watchers.stop();

    expect(existsSync(join(realDir, 'NEW_FROM_AGENT.md'))).toBe(true);
    expect(readFileSync(join(realDir, 'NEW_FROM_AGENT.md'), 'utf8')).toContain(
      'hello from shadow',
    );
  });

  it('exitSweep does not promote excluded provider paths', () => {
    const watchers = startWrapWatchers({
      realProjectPath: realDir,
      workspacePath: wsDir,
      providerId: 'cursor',
      capabilitiesPath: capsPath,
      exclusionProviderIds: CURSOR_ONLY,
    });

    mkdirSync(join(wsDir, '.cursor'), { recursive: true });
    writeFileSync(join(wsDir, '.cursor', 'rules.md'), 'noise\n');
    watchers.exitSweep();
    watchers.stop();

    // .cursor is excluded — promote must not create it in the real project
    // when it was capa-materialized only in the shadow.
    // (If real already had .cursor it would remain; here it must stay absent.)
    expect(existsSync(join(realDir, '.cursor'))).toBe(false);
  });
});
