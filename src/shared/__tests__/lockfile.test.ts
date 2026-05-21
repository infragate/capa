import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';
import {
  LOCKFILE_NAME,
  LockfileBuilder,
  detectLockfileFormat,
  emptyLockfile,
  getLockfilePath,
  loadLockfile,
  saveLockfile,
  serializeLockfile,
} from '../lockfile';
import type { LockPluginEntry, LockSkillEntry, Lockfile } from '../../types/lockfile';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'capa-lockfile-test-'));
}

const sampleSkill: LockSkillEntry = {
  id: 'my-skill',
  source: 'github',
  repo: 'owner/repo',
  skillName: 'my-skill',
  requestedVersion: 'v1.2.3',
  requestedRef: null,
  resolvedRef: '5f8a3c2bcafe1234567890abcdef1234567890ab',
  resolvedVersion: 'v1.2.3',
};

const samplePlugin: LockPluginEntry = {
  id: 'my-plugin',
  source: 'github',
  repo: 'owner/plugin',
  subpath: null,
  requestedSearchName: null,
  requestedVersion: null,
  requestedRef: null,
  resolvedRef: '5f8a3c2bcafe1234567890abcdef1234567890ab',
  resolvedVersion: null,
  manifestName: 'my-plugin',
  manifestVersion: '0.4.0',
};

describe('lockfile', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe('getLockfilePath', () => {
    it('returns capabilities.lock under the project root', () => {
      expect(getLockfilePath(projectDir)).toBe(join(projectDir, LOCKFILE_NAME));
    });
  });

  describe('detectLockfileFormat', () => {
    it('returns yaml when no capabilities file is present', () => {
      expect(detectLockfileFormat(projectDir)).toBe('yaml');
    });

    it('returns json when capabilities.json exists', () => {
      writeFileSync(join(projectDir, 'capabilities.json'), '{}');
      expect(detectLockfileFormat(projectDir)).toBe('json');
    });

    it('returns yaml when capabilities.yaml exists', () => {
      writeFileSync(join(projectDir, 'capabilities.yaml'), 'providers: []');
      expect(detectLockfileFormat(projectDir)).toBe('yaml');
    });
  });

  describe('emptyLockfile', () => {
    it('produces a valid empty struct', () => {
      const lf = emptyLockfile();
      expect(lf.version).toBe(1);
      expect(lf.skills).toEqual([]);
      expect(lf.plugins).toEqual([]);
      expect(lf.generator).toMatch(/^capa@/);
    });
  });

  describe('serializeLockfile', () => {
    it('round-trips through yaml', () => {
      const lf: Lockfile = { ...emptyLockfile(), skills: [sampleSkill], plugins: [samplePlugin] };
      const text = serializeLockfile(lf, 'yaml');
      const parsed = yaml.load(text) as Lockfile;
      expect(parsed.version).toBe(1);
      expect(parsed.skills[0].resolvedRef).toBe(sampleSkill.resolvedRef);
      expect(parsed.plugins[0].manifestName).toBe('my-plugin');
    });

    it('round-trips through json', () => {
      const lf: Lockfile = { ...emptyLockfile(), skills: [sampleSkill], plugins: [samplePlugin] };
      const text = serializeLockfile(lf, 'json');
      const parsed = JSON.parse(text) as Lockfile;
      expect(parsed.version).toBe(1);
      expect(parsed.skills[0].id).toBe('my-skill');
    });
  });

  describe('saveLockfile + loadLockfile', () => {
    it('returns null when no lockfile exists', async () => {
      const lf = await loadLockfile(projectDir);
      expect(lf).toBeNull();
    });

    it('writes and reads a yaml lockfile', async () => {
      const lf: Lockfile = { ...emptyLockfile(), skills: [sampleSkill] };
      await saveLockfile(projectDir, lf, 'yaml');
      expect(existsSync(join(projectDir, LOCKFILE_NAME))).toBe(true);

      const loaded = await loadLockfile(projectDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.skills.length).toBe(1);
      expect(loaded!.skills[0].id).toBe('my-skill');
      expect(loaded!.skills[0].resolvedRef).toBe(sampleSkill.resolvedRef);
    });

    it('writes and reads a json lockfile', async () => {
      writeFileSync(join(projectDir, 'capabilities.json'), '{}');
      const lf: Lockfile = { ...emptyLockfile(), plugins: [samplePlugin] };
      await saveLockfile(projectDir, lf);

      const loaded = await loadLockfile(projectDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.plugins.length).toBe(1);
      expect(loaded!.plugins[0].manifestName).toBe('my-plugin');
    });

    it('throws on a malformed lockfile (wrong version)', async () => {
      writeFileSync(join(projectDir, LOCKFILE_NAME), 'version: 99\nskills: []\nplugins: []\n');
      await expect(loadLockfile(projectDir)).rejects.toThrow(/Unsupported lockfile version/);
    });

    it('returns null on an empty lockfile', async () => {
      writeFileSync(join(projectDir, LOCKFILE_NAME), '');
      const lf = await loadLockfile(projectDir);
      expect(lf).toBeNull();
    });

    it('skips malformed skill/plugin entries with a warning', async () => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const lf = {
        version: 1,
        generator: 'capa@test',
        generatedAt: '2026-01-01T00:00:00.000Z',
        skills: [
          sampleSkill,
          { id: 'bad-skill', source: 'github' },
          null,
        ],
        plugins: [
          samplePlugin,
          { repo: 'owner/missing-id' },
        ],
      };
      writeFileSync(join(projectDir, LOCKFILE_NAME), JSON.stringify(lf));
      const loaded = await loadLockfile(projectDir);
      expect(loaded!.skills).toHaveLength(1);
      expect(loaded!.skills[0].id).toBe('my-skill');
      expect(loaded!.plugins).toHaveLength(1);
      expect(loaded!.plugins[0].id).toBe('my-plugin');
      expect(warnSpy).toHaveBeenCalledWith('Lockfile: skipping invalid skill entry at index 1');
      expect(warnSpy).toHaveBeenCalledWith('Lockfile: skipping invalid skill entry at index 2');
      expect(warnSpy).toHaveBeenCalledWith('Lockfile: skipping invalid plugin entry at index 1');
      warnSpy.mockRestore();
    });
  });

  describe('LockfileBuilder', () => {
    it('starts empty when given null', () => {
      const b = new LockfileBuilder(null);
      const lf = b.build();
      expect(lf.skills).toEqual([]);
      expect(lf.plugins).toEqual([]);
    });

    it('hydrates from an existing lockfile', () => {
      const initial: Lockfile = { ...emptyLockfile(), skills: [sampleSkill] };
      const b = new LockfileBuilder(initial);
      const found = b.findSkill('my-skill', 'v1.2.3', null);
      expect(found?.resolvedRef).toBe(sampleSkill.resolvedRef);
    });

    it('returns null when the requested version no longer matches', () => {
      const initial: Lockfile = { ...emptyLockfile(), skills: [sampleSkill] };
      const b = new LockfileBuilder(initial);
      expect(b.findSkill('my-skill', 'v9.9.9', null)).toBeNull();
    });

    it('returns null when the requested ref no longer matches', () => {
      const pinnedBySha: LockSkillEntry = {
        ...sampleSkill,
        requestedVersion: null,
        requestedRef: 'abc1234',
      };
      const initial: Lockfile = { ...emptyLockfile(), skills: [pinnedBySha] };
      const b = new LockfileBuilder(initial);
      expect(b.findSkill('my-skill', null, 'def5678')).toBeNull();
      expect(b.findSkill('my-skill', null, 'abc1234')?.resolvedRef).toBe(sampleSkill.resolvedRef);
    });

    it('upserts replaces previous entry by id', () => {
      const b = new LockfileBuilder(null);
      b.upsertSkill(sampleSkill);
      const updated: LockSkillEntry = { ...sampleSkill, resolvedRef: 'newshawith40chars1234567890abcdef12345678' };
      b.upsertSkill(updated);
      const lf = b.build();
      expect(lf.skills.length).toBe(1);
      expect(lf.skills[0].resolvedRef).toBe(updated.resolvedRef);
    });

    it('findPlugin filters by source + repo + subpath + version + ref', () => {
      const initial: Lockfile = { ...emptyLockfile(), plugins: [samplePlugin] };
      const b = new LockfileBuilder(initial);
      expect(b.findPlugin({ source: 'github', repo: 'owner/plugin', subpath: null, requestedVersion: null, requestedRef: null })?.id).toBe(samplePlugin.id);
      expect(b.findPlugin({ source: 'github', repo: 'other/plugin', subpath: null, requestedVersion: null, requestedRef: null })).toBeNull();
      expect(b.findPlugin({ source: 'github', repo: 'owner/plugin', subpath: null, requestedVersion: 'v1.0.0', requestedRef: null })).toBeNull();
    });

    it('findPlugin distinguishes entries by subpath', () => {
      const pluginAtRoot = { ...samplePlugin, id: 'root-plugin', subpath: null };
      const pluginAtSub = { ...samplePlugin, id: 'sub-plugin', subpath: 'plugins/frontend' };
      const b = new LockfileBuilder({ ...emptyLockfile(), plugins: [pluginAtRoot, pluginAtSub] });
      expect(b.findPlugin({ source: 'github', repo: 'owner/plugin', subpath: null, requestedVersion: null, requestedRef: null })?.id).toBe('root-plugin');
      expect(b.findPlugin({ source: 'github', repo: 'owner/plugin', subpath: 'plugins/frontend', requestedVersion: null, requestedRef: null })?.id).toBe('sub-plugin');
      expect(b.findPlugin({ source: 'github', repo: 'owner/plugin', subpath: 'plugins/other', requestedVersion: null, requestedRef: null })).toBeNull();
    });

    it('findPlugin pivots on requestedSearchName and ignores the resolved subpath', () => {
      const searched: LockPluginEntry = {
        ...samplePlugin,
        id: 'searched-plugin',
        subpath: 'plugins/code-review', // resolved from a previous walk
        requestedSearchName: 'code-review',
      };
      const exact: LockPluginEntry = {
        ...samplePlugin,
        id: 'exact-plugin',
        subpath: 'plugins/code-review',
        requestedSearchName: null,
      };
      const b = new LockfileBuilder({ ...emptyLockfile(), plugins: [searched, exact] });

      // Search query matches the search entry even though we pass subpath: null —
      // when a search is requested the lockfile shouldn't gate the lookup on a
      // resolved subpath (which the caller doesn't know yet).
      expect(
        b.findPlugin({ source: 'github', repo: 'owner/plugin', subpath: null, requestedSearchName: 'code-review', requestedVersion: null, requestedRef: null })?.id
      ).toBe('searched-plugin');

      // Exact-path query is unaffected and still matches the non-search entry.
      expect(
        b.findPlugin({ source: 'github', repo: 'owner/plugin', subpath: 'plugins/code-review', requestedSearchName: null, requestedVersion: null, requestedRef: null })?.id
      ).toBe('exact-plugin');

      // A search miss returns null even if the resolved subpath happens to collide.
      expect(
        b.findPlugin({ source: 'github', repo: 'owner/plugin', subpath: null, requestedSearchName: 'debugger', requestedVersion: null, requestedRef: null })
      ).toBeNull();
    });

    it('pruneToIds drops entries not in the provided sets', () => {
      const b = new LockfileBuilder(null);
      b.upsertSkill(sampleSkill);
      b.upsertSkill({ ...sampleSkill, id: 'other-skill' });
      b.upsertPlugin(samplePlugin);
      b.pruneToIds(new Set(['my-skill']), new Set());
      const lf = b.build();
      expect(lf.skills.map((s) => s.id)).toEqual(['my-skill']);
      expect(lf.plugins).toEqual([]);
    });

    it('build sorts entries by id for stable diffs', () => {
      const b = new LockfileBuilder(null);
      b.upsertSkill({ ...sampleSkill, id: 'zeta' });
      b.upsertSkill({ ...sampleSkill, id: 'alpha' });
      const lf = b.build();
      expect(lf.skills.map((s) => s.id)).toEqual(['alpha', 'zeta']);
    });
  });
});
