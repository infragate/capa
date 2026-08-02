import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import {
  CAPA_GITIGNORE_END,
  CAPA_GITIGNORE_START,
  buildCapaGitignoreBlock,
  composeExcludeFile,
  ensureWrapGitLayout,
  stripCapaGitignoreBlock,
  syncWrapGitExclude,
} from '../git-exclude-sync';
import { buildSymlinkWorkspace } from '../symlink-workspace';

const CURSOR_ONLY = ['cursor'];

describe('git-exclude-sync', () => {
  let realDir: string;
  let wsDir: string;

  beforeEach(() => {
    realDir = mkdtempSync(join(tmpdir(), 'capa-ex-real-'));
    wsDir = mkdtempSync(join(tmpdir(), 'capa-ex-ws-'));
    mkdirSync(join(realDir, '.git', 'objects'), { recursive: true });
    mkdirSync(join(realDir, '.git', 'refs'), { recursive: true });
    mkdirSync(join(realDir, '.git', 'info'), { recursive: true });
    writeFileSync(join(realDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(realDir, '.git', 'info', 'exclude'), '');
  });

  afterEach(() => {
    rmSync(realDir, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  });

  it('stripCapaGitignoreBlock removes the marked section', () => {
    const text = `*.log\n\n${CAPA_GITIGNORE_START}\n.cursor\n${CAPA_GITIGNORE_END}\n`;
    expect(stripCapaGitignoreBlock(text)).toBe('*.log');
  });

  it('buildCapaGitignoreBlock lists cursor-owned names', () => {
    const block = buildCapaGitignoreBlock(CURSOR_ONLY);
    expect(block).toContain('.cursor');
    expect(block).toContain('AGENTS.md');
    expect(block).not.toContain('.claude');
  });

  it('ensureWrapGitLayout links .git children but keeps info real', () => {
    const ok = ensureWrapGitLayout(realDir, wsDir);
    expect(ok).toBe(true);
    expect(lstatSync(join(wsDir, '.git')).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(wsDir, '.git', 'info')).isSymbolicLink()).toBe(false);
    if (platform() !== 'win32') {
      expect(lstatSync(join(wsDir, '.git', 'objects')).isSymbolicLink()).toBe(true);
      expect(lstatSync(join(wsDir, '.git', 'HEAD')).isSymbolicLink()).toBe(true);
    } else {
      expect(existsSync(join(wsDir, '.git', 'objects'))).toBe(true);
      expect(existsSync(join(wsDir, '.git', 'HEAD'))).toBe(true);
    }
  });

  it('syncWrapGitExclude writes CAPA block only in shadow exclude', () => {
    writeFileSync(join(realDir, '.git', 'info', 'exclude'), '*.local\n');
    syncWrapGitExclude(realDir, wsDir, CURSOR_ONLY);

    expect(readFileSync(join(realDir, '.git', 'info', 'exclude'), 'utf8')).toBe(
      '*.local\n',
    );

    const shadow = readFileSync(join(wsDir, '.git', 'info', 'exclude'), 'utf8');
    expect(shadow).toContain('*.local');
    expect(shadow).toContain(CAPA_GITIGNORE_START);
    expect(shadow).toContain('.cursor');
    expect(shadow).toContain(CAPA_GITIGNORE_END);
  });

  it('second sync does not stack duplicate CAPA blocks', () => {
    writeFileSync(join(realDir, '.git', 'info', 'exclude'), 'tmp\n');
    syncWrapGitExclude(realDir, wsDir, CURSOR_ONLY);
    syncWrapGitExclude(realDir, wsDir, CURSOR_ONLY);
    const shadow = readFileSync(join(wsDir, '.git', 'info', 'exclude'), 'utf8');
    expect(shadow.split(CAPA_GITIGNORE_START).length - 1).toBe(1);
  });

  it('upgrades a full .git junction to selective layout', () => {
    // Simulate legacy wrap: full-dir link of .git
    if (platform() === 'win32') {
      symlinkSync(join(realDir, '.git'), join(wsDir, '.git'), 'junction');
    } else {
      symlinkSync(join(realDir, '.git'), join(wsDir, '.git'));
    }
    expect(lstatSync(join(wsDir, '.git')).isSymbolicLink()).toBe(true);

    syncWrapGitExclude(realDir, wsDir, CURSOR_ONLY);
    expect(lstatSync(join(wsDir, '.git')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(realDir, '.git', 'info', 'exclude'), 'utf8')).not.toContain(
      CAPA_GITIGNORE_START,
    );
    expect(
      readFileSync(join(wsDir, '.git', 'info', 'exclude'), 'utf8'),
    ).toContain(CAPA_GITIGNORE_START);
  });

  it('buildSymlinkWorkspace leaves .gitignore linked and exclude augmented', () => {
    writeFileSync(join(realDir, 'capabilities.yaml'), 'skills: []\n');
    writeFileSync(join(realDir, '.gitignore'), 'node_modules\n');
    writeFileSync(join(realDir, '.git', 'info', 'exclude'), '');
    mkdirSync(join(realDir, 'src'));
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_ONLY);

    expect(existsSync(join(wsDir, '.gitignore'))).toBe(true);
    expect(readFileSync(join(wsDir, '.gitignore'), 'utf8')).toBe('node_modules\n');
    expect(readFileSync(join(realDir, '.gitignore'), 'utf8')).toBe('node_modules\n');

    const exclude = readFileSync(join(wsDir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain(CAPA_GITIGNORE_START);
    expect(exclude).toBe(composeExcludeFile('', CURSOR_ONLY));
  });

  it('does not mutate real exclude when shadow block regenerates', () => {
    writeFileSync(join(realDir, '.git', 'info', 'exclude'), 'keep-me\n');
    syncWrapGitExclude(realDir, wsDir, CURSOR_ONLY);
    // Simulate agent editing only the shadow exclude inside CAPA block
    writeFileSync(
      join(wsDir, '.git', 'info', 'exclude'),
      composeExcludeFile('keep-me', CURSOR_ONLY).replace('.cursor', '.cursor\nHACK'),
    );
    syncWrapGitExclude(realDir, wsDir, CURSOR_ONLY);

    expect(readFileSync(join(realDir, '.git', 'info', 'exclude'), 'utf8')).toBe(
      'keep-me\n',
    );
    expect(readFileSync(join(wsDir, '.git', 'info', 'exclude'), 'utf8')).not.toContain(
      'HACK',
    );
  });
});
