import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  listProjectFs,
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

  it('lists directories and filters by extension', () => {
    const all = listProjectFs(root, '');
    expect(all.entries.map((e) => e.name).sort()).toEqual(['docs', 'readme.txt', 'skills']);

    const md = listProjectFs(root, 'docs', { ext: 'md' });
    expect(md.entries).toEqual([{ name: 'rules.md', type: 'file', path: 'docs/rules.md' }]);

    const dirs = listProjectFs(root, 'skills', { dirsOnly: true });
    expect(dirs.entries.every((e) => e.type === 'dir')).toBe(true);
    expect(dirs.entries.map((e) => e.name)).toEqual(['foo']);
  });

  it('rejects paths that escape the project root', () => {
    expect(() => resolveInsideProject(root, '..')).toThrow();
    expect(() => resolveInsideProject(root, '../outside')).toThrow();
    expect(() => resolveInsideProject(root, 'docs/../../etc/passwd')).toThrow();
  });

  it('writes uploads under .capa/imports', () => {
    const bytes = new TextEncoder().encode('# imported\n');
    const file = writeProjectImport(root, { filename: 'note.md', bytes });
    expect(file.path.startsWith('.capa/imports/')).toBe(true);
    expect(file.path.endsWith('note.md') || file.path.includes('note')).toBe(true);

    const skill = writeProjectImport(root, {
      filename: 'my-skill.md',
      bytes,
      asSkillDir: true,
    });
    expect(skill.path).toBe('.capa/imports/my-skill');
  });
});
