import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { CapaDatabase } from '../../../db/database';
import { initSchema } from '../../../db/schema';
import { LockfileBuilder } from '../../../shared/lockfile';
import { pluginSkillSnippet, resolvePlugins } from '../plugin-install';
import type { Capabilities } from '../../../types/capabilities';

/** A Claude plugin at `root/<subdir>` with one `handoff` skill saying `body`. */
function writePlugin(root: string, subdir: string, name: string, body: string): void {
  const base = join(root, subdir);
  mkdirSync(join(base, '.claude-plugin'), { recursive: true });
  writeFileSync(join(base, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
  mkdirSync(join(base, 'skills', 'handoff'), { recursive: true });
  writeFileSync(
    join(base, 'skills', 'handoff', 'SKILL.md'),
    `---\nname: handoff\ndescription: hand off\n---\n\n${body}\n`,
  );
}

describe('plugin skills with the same name (#330)', () => {
  let dir: string;
  let db: CapaDatabase;
  let projectPath: string;
  let pluginsBase: string;
  const snapshots: Record<string, string> = {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capa-plugin-conflict-'));
    projectPath = join(dir, 'project');
    pluginsBase = join(dir, 'plugins-base');
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(pluginsBase, { recursive: true });
    snapshots['mattpocock/skills'] = join(dir, 'snap-matt');
    snapshots['Ovid/paad'] = join(dir, 'snap-paad');
    writePlugin(snapshots['mattpocock/skills'], '', 'mattpocock-skills', 'from matt');
    writePlugin(snapshots['Ovid/paad'], 'plugins/paad', 'paad', 'from paad');
    writeFileSync(join(projectPath, 'capabilities.yaml'), 'providers: [claude-code]\n');

    const dbPath = join(dir, 'test.db');
    const sqlite = new Database(dbPath, { create: true });
    initSchema(sqlite);
    sqlite.close();
    db = new CapaDatabase(dbPath);
    db.upsertProject({ id: 'proj-conflict', path: projectPath });
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  async function run(caps: Partial<Capabilities>) {
    return resolvePlugins(
      { providers: ['claude-code'], skills: [], servers: [], tools: [], ...caps } as Capabilities,
      projectPath,
      'proj-conflict',
      (async () => new Response()) as never,
      db,
      async (_platform, repoPath) => ({
        snapshotDir: snapshots[repoPath]!,
        resolvedSha: 'a'.repeat(40),
        resolvedVersion: null,
      }),
      join(projectPath, 'capabilities.yaml'),
      new LockfileBuilder(null),
      { materializeProjectSkills: true, pluginsBaseDir: pluginsBase, trackManaged: true },
    );
  }

  const installed = () =>
    readFileSync(join(projectPath, '.claude', 'skills', 'handoff', 'SKILL.md'), 'utf8');

  it('keeps the first plugin\'s skill and says how to install the other one', async () => {
    const result = await run({
      plugins: [
        { id: 'mattpocock-skills', type: 'github', def: { repo: 'mattpocock/skills' } },
        { id: 'paad', type: 'github', def: { repo: 'Ovid/paad::plugins/paad' } },
      ],
    });

    // On disk and in the catalog: the first plugin's skill, not overwritten.
    expect(installed()).toContain('from matt');
    const skill = result.mergedCapabilities.skills.find((s) => s.id === 'handoff');
    expect(skill?.sourcePlugin?.id).toBe('mattpocock-skills');

    const warning = result.warnings.find((w) => w.includes('"handoff"'));
    expect(warning).toContain(
      'Skill "handoff" is provided by plugins "mattpocock-skills" and "paad"; installed the one from "mattpocock-skills"',
    );
    expect(warning).toContain('- id: paad-handoff');
    expect(warning).toContain('repo: Ovid/paad::plugins/paad/skills/handoff');
    expect(warning).toContain('list "paad" before "mattpocock-skills"');
  });

  it('stays quiet once the other version is declared as its own skill', async () => {
    const result = await run({
      skills: [
        {
          id: 'paad-handoff',
          type: 'github',
          def: { repo: 'Ovid/paad::plugins/paad/skills/handoff' },
        },
      ],
      plugins: [
        { id: 'mattpocock-skills', type: 'github', def: { repo: 'mattpocock/skills' } },
        { id: 'paad', type: 'github', def: { repo: 'Ovid/paad::plugins/paad' } },
      ],
    });
    expect(installed()).toContain('from matt');
    expect(result.warnings.some((w) => w.includes('"handoff"'))).toBe(false);
  });

  it('never replaces a skill the capabilities file declares', async () => {
    const result = await run({
      skills: [{ id: 'handoff', type: 'inline', def: { content: 'mine' } }],
      plugins: [{ id: 'paad', type: 'github', def: { repo: 'Ovid/paad::plugins/paad' } }],
    });
    const warning = result.warnings.find((w) => w.includes('"handoff"'));
    expect(warning).toContain('which the capabilities file already declares');
    expect(warning).toContain('- id: paad-handoff');
    expect(warning).not.toContain('list "paad" before');
    expect(result.mergedCapabilities.skills.filter((s) => s.id === 'handoff')).toHaveLength(1);
  });
});

describe('pluginSkillSnippet', () => {
  it('builds github, gitlab and git entries, keeping dot folders and pins', () => {
    expect(
      pluginSkillSnippet({
        id: 'glab-glab',
        platform: 'gitlab',
        repoPath: 'gitlab-org/ai/skills',
        pluginSubpath: '.claude-plugin/plugins/glab',
        relativePath: 'skills/glab',
        version: 'v1.2.0',
      }),
    ).toBe(
      [
        '- id: glab-glab',
        '  type: gitlab',
        '  def:',
        '    repo: gitlab-org/ai/skills::.claude-plugin/plugins/glab/skills/glab',
        '    version: v1.2.0',
      ].join('\n'),
    );
    expect(
      pluginSkillSnippet({
        id: 'p-root',
        platform: 'github',
        repoPath: 'o/r',
        relativePath: '.',
      }),
    ).toBe(['- id: p-root', '  type: github', '  def:', '    repo: o/r'].join('\n'));
    expect(
      pluginSkillSnippet({
        id: 'x-y',
        platform: 'git',
        repoPath: 'git.example.com/o/r',
        repoUrl: 'https://git.example.com/o/r.git',
        relativePath: 'skills\\y',
        ref: 'a'.repeat(40),
      }),
    ).toBe(
      [
        '- id: x-y',
        '  type: git',
        '  def:',
        '    url: https://git.example.com/o/r.git',
        '    path: skills/y',
        `    ref: ${'a'.repeat(40)}`,
      ].join('\n'),
    );
  });

  it('returns null for skills made from plugin commands', () => {
    expect(
      pluginSkillSnippet({ id: 'p-c', platform: 'github', repoPath: 'o/r', relativePath: '.capa-commands/c' }),
    ).toBeNull();
  });
});
