import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  listProjectFs,
  mkdirInsideProject,
  resolveInsideProject,
  writeProjectImport,
} from '../project-fs';

describe('project-fs', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'capa-project-fs-'));
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'skills', 'foo'), { recursive: true });
    writeFileSync(join(root, 'docs', 'rules.md'), '# rules\n');
    writeFileSync(join(root, 'skills', 'foo', 'SKILL.md'), '# skill\n');
    writeFileSync(join(root, 'readme.txt'), 'hi\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists directories and filters by extension', async () => {
    const all = await listProjectFs(root, '');
    expect(all.entries.map((e) => e.name).sort()).toEqual(['docs', 'readme.txt', 'skills']);

    const md = await listProjectFs(root, 'docs', { ext: 'md' });
    expect(md.entries).toEqual([{ name: 'rules.md', type: 'file', path: 'docs/rules.md' }]);

    const dirs = await listProjectFs(root, 'skills', { dirsOnly: true });
    expect(dirs.entries.every((e) => e.type === 'dir')).toBe(true);
    expect(dirs.entries.map((e) => e.name)).toEqual(['foo']);
  });

  it('keeps navigation project-relative and supplies config-relative selections', async () => {
    mkdirSync(join(root, '.config', 'capa'), { recursive: true });
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, '.private'));
    writeFileSync(join(root, '.config', 'capa', 'config.toml'), 'providers = []\n');
    const top = await listProjectFs(root);
    expect(top.entries.map(e => e.name)).toContain('.config');
    expect(top.entries.map(e => e.name)).not.toContain('.git');
    expect(top.entries.map(e => e.name)).not.toContain('.private');
    for (const kind of ['rules', 'instructions', 'skills'] as const) {
      const listed = await listProjectFs(root, 'docs', { kind });
      expect(listed.path).toBe('docs');
      expect(listed.entries[0]).toEqual({ name: 'rules.md', type: 'file', path: 'docs/rules.md', storedPath: kind === 'skills' ? 'docs/rules.md' : '../../docs/rules.md' });
    }
    const skill = await listProjectFs(root, 'skills', { kind: 'skills', dirsOnly: true });
    expect(skill.entries[0].storedPath).toBe('skills/foo');
  });

  it('does not browse through a symlink outside the project', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'capa-browse-outside-'));
    try {
      symlinkSync(outside, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(listProjectFs(root, 'outside', { kind: 'instructions' })).rejects.toThrow(/escapes/);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it('rejects paths that escape the project root', () => {
    expect(() => resolveInsideProject(root, '..')).toThrow();
    expect(() => resolveInsideProject(root, '../outside')).toThrow();
    expect(() => resolveInsideProject(root, 'docs/../../etc/passwd')).toThrow();
  });

  it('writes uploads under .capa/imports when capabilities are at root', async () => {
    writeFileSync(join(root, 'capabilities.yaml'), 'providers: []\n');
    const bytes = new TextEncoder().encode('# imported\n');
    const file = await writeProjectImport(root, {
      filename: 'note.md',
      bytes,
      kind: 'rules',
    });
    expect(file.path.startsWith('.capa/imports/')).toBe(true);
    expect(file.path.endsWith('note.md') || file.path.includes('note')).toBe(true);

    const skill = await writeProjectImport(root, {
      filename: 'my-skill.md',
      bytes,
      kind: 'skills',
      asSkillDir: true,
    });
    expect(skill.path).toBe('.capa/imports/my-skill');
  });

  it('writes uploads under typed .config/capa dirs', async () => {
    mkdirSync(join(root, '.config'), { recursive: true });
    writeFileSync(join(root, '.config', 'capabilities.yaml'), 'providers: []\n');
    const bytes = new TextEncoder().encode('# rule\n');
    const file = await writeProjectImport(root, {
      filename: 'note.md',
      bytes,
      kind: 'rules',
    });
    expect(file.path).toBe('capa/rules/note.md');
    expect(existsSync(join(root, '.config', 'capa', 'rules', 'note.md'))).toBe(
      true,
    );

    const skill = await writeProjectImport(root, {
      filename: 'my-skill.md',
      bytes,
      kind: 'skills',
      asSkillDir: true,
    });
    expect(skill.path).toBe('.config/capa/skills/my-skill');
  });

  it('returns portable upload paths through a symlinked project root', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'capa-upload-alias-'));
    const alias = join(parent, 'alias');
    try {
      symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
      mkdirSync(join(root, '.config', 'capa'), { recursive: true });
      writeFileSync(join(root, '.config', 'capa', 'config.toml'), 'providers = []\n');
      for (const kind of ['skills', 'rules', 'instructions'] as const) {
        const result = await writeProjectImport(alias, { filename: 'note.md', bytes: new TextEncoder().encode('# note'), kind });
        expect(result.path).toBe(kind === 'skills' ? '.config/capa/skills/note.md' : `${kind}/note.md`);
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('refuses to mkdir through a symlink that escapes the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'capa-outside-'));
    try {
      try {
        symlinkSync(outside, join(root, '.capa'), process.platform === 'win32' ? 'junction' : undefined);
      } catch {
        // Symlink creation may require elevated privileges on Windows.
        return;
      }
      expect(() => mkdirInsideProject(root, '.capa/imports')).toThrow(/symlink/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
