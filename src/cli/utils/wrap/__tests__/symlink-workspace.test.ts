import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  lstatSync,
  readlinkSync,
  realpathSync,
  readFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import {
  buildSymlinkWorkspace,
  syncTopLevelSymlinks,
  promoteToRealProject,
  getWrapExclusionSet,
  removeTopLevelEntry,
} from '../symlink-workspace';
import { WORKSPACE_MARKER } from '../../../../shared/workspaces/paths';
import { LOCKFILE_NAME } from '../../../../shared/lockfile';

/** Cursor wrap with capabilities.providers: [cursor] — does not pull in openclaw/claude. */
const CURSOR_ONLY = ['cursor'];
/** Wrap that also installs for claude-code from capabilities. */
const CURSOR_AND_CLAUDE = ['cursor', 'claude-code'];

describe('symlink-workspace', () => {
  let realDir: string;
  let wsDir: string;

  beforeEach(() => {
    realDir = mkdtempSync(join(tmpdir(), 'capa-wrap-real-'));
    wsDir = mkdtempSync(join(tmpdir(), 'capa-wrap-ws-'));
    mkdirSync(join(realDir, 'src'));
    writeFileSync(join(realDir, 'src', 'a.ts'), 'export {}');
    writeFileSync(join(realDir, 'capabilities.yaml'), 'skills: []\n');
    writeFileSync(join(realDir, LOCKFILE_NAME), 'version: 1\nskills: []\nplugins: []\n');
    mkdirSync(join(realDir, '.git'));
    mkdirSync(join(realDir, '.cursor'));
    writeFileSync(join(realDir, '.cursor', 'x'), 'nope');
    mkdirSync(join(realDir, '.claude'));
    writeFileSync(join(realDir, 'CLAUDE.md'), 'x');
    writeFileSync(join(realDir, 'AGENTS.md'), 'y');
    mkdirSync(join(realDir, 'skills'));
    writeFileSync(join(realDir, 'skills', 'SKILL.md'), 'local');
  });

  afterEach(() => {
    rmSync(realDir, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  });

  it('exclusion set is scoped to listed providers (not the full registry)', () => {
    const cursorOnly = getWrapExclusionSet(CURSOR_ONLY);
    expect(cursorOnly.has('.cursor')).toBe(true);
    expect(cursorOnly.has('AGENTS.md')).toBe(true);
    expect(cursorOnly.has('.claude')).toBe(false);
    expect(cursorOnly.has('CLAUDE.md')).toBe(false);
    expect(cursorOnly.has('skills')).toBe(false);
    expect(cursorOnly.has(LOCKFILE_NAME)).toBe(true);
    expect(cursorOnly.has(WORKSPACE_MARKER)).toBe(true);

    const both = getWrapExclusionSet(CURSOR_AND_CLAUDE);
    expect(both.has('.cursor')).toBe(true);
    expect(both.has('.claude')).toBe(true);
    expect(both.has('CLAUDE.md')).toBe(true);
    expect(both.has('skills')).toBe(false);
  });

  it('symlinks src and skills for cursor-only; skips .cursor and AGENTS.md', () => {
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_ONLY);

    expect(lstatSync(join(wsDir, 'src')).isDirectory() || lstatSync(join(wsDir, 'src')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(wsDir, 'src', 'a.ts'))).toBe(true);
    expect(existsSync(join(wsDir, 'capabilities.yaml'))).toBe(true);
    expect(readFileSync(join(wsDir, 'capabilities.yaml'), 'utf8')).toContain('skills');
    expect(existsSync(join(wsDir, 'skills'))).toBe(true);

    expect(existsSync(join(wsDir, '.cursor'))).toBe(false);
    expect(existsSync(join(wsDir, 'AGENTS.md'))).toBe(false);
    // Not in capabilities providers → still symlinked
    expect(existsSync(join(wsDir, '.claude'))).toBe(true);
    expect(existsSync(join(wsDir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(wsDir, LOCKFILE_NAME))).toBe(false);

    if (platform() !== 'win32') {
      expect(lstatSync(join(wsDir, 'src')).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(wsDir, 'capabilities.yaml'))).toContain('capabilities.yaml');
    } else {
      expect(realpathSync(join(wsDir, 'src'))).toBe(realpathSync(join(realDir, 'src')));
    }
  });

  it('skips .claude when capabilities also lists claude-code', () => {
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_AND_CLAUDE);
    expect(existsSync(join(wsDir, '.cursor'))).toBe(false);
    expect(existsSync(join(wsDir, '.claude'))).toBe(false);
    expect(existsSync(join(wsDir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(wsDir, 'skills'))).toBe(true);
  });

  it('sync adds a link for a new top-level file', () => {
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_ONLY);
    writeFileSync(join(realDir, 'NEW.md'), 'hello');
    const linked = syncTopLevelSymlinks(realDir, wsDir, CURSOR_ONLY);
    expect(linked).toContain('NEW.md');
    expect(existsSync(join(wsDir, 'NEW.md'))).toBe(true);
    expect(readFileSync(join(wsDir, 'NEW.md'), 'utf8')).toBe('hello');
  });

  it('sync ignores newly created dirs owned by the wrap providers', () => {
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_ONLY);
    mkdirSync(join(realDir, '.cursor', 'rules'), { recursive: true });
    // .cursor already excluded; a brand-new excluded top-level shouldn't link
    // (recreate exclusion target as a sibling that is still owned — AGENTS.md)
    writeFileSync(join(realDir, 'AGENTS.md'), 'updated');
    syncTopLevelSymlinks(realDir, wsDir, CURSOR_ONLY);
    expect(existsSync(join(wsDir, 'AGENTS.md'))).toBe(false);
  });

  it('sync does link unrelated provider dirs that are not in the exclusion set', () => {
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_ONLY);
    mkdirSync(join(realDir, '.opencode'), { recursive: true });
    syncTopLevelSymlinks(realDir, wsDir, CURSOR_ONLY);
    expect(existsSync(join(wsDir, '.opencode'))).toBe(true);
  });

  it('promote moves a workspace-only file into the real project and leaves a link', () => {
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_ONLY);
    writeFileSync(join(wsDir, 'NOTES.md'), 'from agent');
    promoteToRealProject(realDir, wsDir, 'NOTES.md', CURSOR_ONLY);

    expect(existsSync(join(realDir, 'NOTES.md'))).toBe(true);
    expect(existsSync(join(wsDir, 'NOTES.md'))).toBe(true);
    expect(readFileSync(join(realDir, 'NOTES.md'), 'utf8')).toBe('from agent');
  });

  it('promote overwrites real with workspace content when both exist separately', () => {
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_ONLY);
    writeFileSync(join(realDir, 'SHARED.md'), 'old');
    writeFileSync(join(wsDir, 'SHARED.md'), 'new from agent');
    promoteToRealProject(realDir, wsDir, 'SHARED.md', CURSOR_ONLY);
    expect(readFileSync(join(realDir, 'SHARED.md'), 'utf8')).toBe('new from agent');
  });

  it('removeTopLevelEntry deletes a file', () => {
    writeFileSync(join(realDir, 'GONE.md'), 'x');
    removeTopLevelEntry(realDir, 'GONE.md');
    expect(existsSync(join(realDir, 'GONE.md'))).toBe(false);
  });

  it('promote does not move provider-owned paths', () => {
    buildSymlinkWorkspace(realDir, wsDir, CURSOR_ONLY);
    mkdirSync(join(wsDir, '.cursor'));
    writeFileSync(join(wsDir, '.cursor', 'settings.json'), '{}');
    promoteToRealProject(realDir, wsDir, '.cursor', CURSOR_ONLY);
    expect(lstatSync(join(wsDir, '.cursor')).isSymbolicLink()).toBe(false);
  });
});
