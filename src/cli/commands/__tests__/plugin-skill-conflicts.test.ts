import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import { CapaDatabase } from '../../../db/database';
import { initSchema } from '../../../db/schema';
import { LockfileBuilder } from '../../../shared/lockfile';
import { resolvePlugins, setSkillMdName } from '../plugin-install';
import { resolveSkillContent } from '../../../server/skill-content';
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

  const skillMd = (id: string) =>
    readFileSync(join(projectPath, '.claude', 'skills', id, 'SKILL.md'), 'utf8');

  const bothPlugins = [
    { id: 'mattpocock-skills', type: 'github' as const, def: { repo: 'mattpocock/skills' } },
    { id: 'paad', type: 'github' as const, def: { repo: 'Ovid/paad::plugins/paad' } },
  ];

  it('keeps the first plugin\'s skill and installs the other under a prefix, with a warning', async () => {
    const result = await run({ plugins: bothPlugins });

    // Not overwritten: /handoff is the first plugin's.
    expect(skillMd('handoff')).toContain('from matt');
    // The second is installed as paad-handoff, named to match its folder.
    expect(skillMd('paad-handoff')).toContain('from paad');
    expect(skillMd('paad-handoff')).toContain('name: paad-handoff');

    const skills = result.mergedCapabilities.skills;
    expect(skills.find((s) => s.id === 'handoff')?.sourcePlugin?.id).toBe('mattpocock-skills');
    const renamed = skills.find((s) => s.id === 'paad-handoff');
    expect(renamed?.sourcePlugin?.id).toBe('paad');
    expect(renamed?.def).toEqual({ path: 'skills/handoff' });

    expect(result.warnings).toContain(
      'Skill "handoff" is provided by plugins "mattpocock-skills" and "paad"; "/handoff" is mattpocock-skills\'s, ' +
        'and paad\'s is installed as "/paad-handoff". To make paad\'s version "/handoff", list it before "mattpocock-skills" in the capabilities file.',
    );
  });

  it('keeps a renamed skill in the plugin agent that uses it', async () => {
    const agents = join(snapshots['Ovid/paad']!, 'plugins', 'paad', 'agents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(
      join(agents, 'helper.md'),
      '---\nname: helper\ndescription: helps\nskills: [handoff]\n---\n\nHelp.\n',
    );
    const result = await run({ plugins: bothPlugins });
    const helper = result.mergedCapabilities.subagents?.find((a) => a.id === 'helper');
    expect(helper?.skills).toEqual(['paad-handoff']);
  });

  it('shows the renamed skill\'s content in the viewer', async () => {
    const result = await run({ plugins: bothPlugins });
    const renamed = result.mergedCapabilities.skills.find((s) => s.id === 'paad-handoff')!;
    const content = resolveSkillContent(projectPath, renamed, [], { pluginsBaseDir: pluginsBase });
    expect(content?.content ?? JSON.stringify(content)).toContain('from paad');
  });

  it('uses the next free id when the prefixed one is taken', async () => {
    const result = await run({
      skills: [{ id: 'paad-handoff', type: 'inline', def: { content: 'unrelated' } }],
      plugins: bothPlugins,
    });
    expect(result.warnings.some((w) => w.includes('installed as "/paad-handoff-2"'))).toBe(true);
    expect(skillMd('paad-handoff-2')).toContain('from paad');
  });

  it('never replaces a skill the capabilities file declares', async () => {
    const result = await run({
      skills: [{ id: 'handoff', type: 'inline', def: { content: 'mine' } }],
      plugins: [bothPlugins[1]!],
    });
    const warning = result.warnings.find((w) => w.includes('"handoff"'));
    expect(warning).toBe(
      'Plugin "paad" also provides skill "handoff", which the capabilities file already declares; "/handoff" stays yours, and paad\'s is installed as "/paad-handoff".',
    );
    expect(result.mergedCapabilities.skills.filter((s) => s.id === 'handoff')).toHaveLength(1);
    expect(skillMd('paad-handoff')).toContain('from paad');
  });
});

describe('setSkillMdName', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'capa-skill-name-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const roundTrip = (text: string) => {
    const file = join(dir, 'SKILL.md');
    writeFileSync(file, text);
    setSkillMdName(file, 'paad-handoff');
    return readFileSync(file, 'utf8');
  };

  it('replaces, adds or creates the name field', () => {
    expect(roundTrip('---\nname: handoff\ndescription: d\n---\n\nBody name: handoff\n')).toBe(
      '---\nname: paad-handoff\ndescription: d\n---\n\nBody name: handoff\n',
    );
    expect(roundTrip('---\ndescription: d\n---\nBody\n')).toBe(
      '---\nname: paad-handoff\ndescription: d\n---\nBody\n',
    );
    expect(roundTrip('Just a body\n')).toBe('---\nname: paad-handoff\n---\n\nJust a body\n');
  });
});
