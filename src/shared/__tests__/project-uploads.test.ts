import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  classifyLegacyImportsFromCapabilities,
  ensureProjectUploadsMigrated,
} from '../project-uploads';
import { parseCapabilitiesFile } from '../capabilities';

describe('project-uploads migration', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'capa-uploads-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('classifies .capa/imports paths by capabilities section', async () => {
    mkdirSync(join(root, '.config'), { recursive: true });
    const capsPath = join(root, '.config', 'capabilities.yaml');
    writeFileSync(
      capsPath,
      [
        'skills:',
        '  - id: s1',
        '    type: local',
        '    def:',
        '      path: .capa/imports/my-skill',
        'rules:',
        '  - id: r1',
        '    type: local',
        '    path: ../.capa/imports/rule.md',
        'agents:',
        '  base:',
        '    type: local',
        '    path: ../.capa/imports/base.md',
        '  additional:',
        '    - id: snip',
        '      type: local',
        '      path: ../.capa/imports/snip.md',
        '',
      ].join('\n'),
    );
    const caps = await parseCapabilitiesFile(capsPath, 'yaml');
    const classified = classifyLegacyImportsFromCapabilities(root, capsPath, caps);
    expect(classified.map((c) => `${c.kind}:${c.projectRel}`).sort()).toEqual([
      'instructions:.capa/imports/base.md',
      'instructions:.capa/imports/snip.md',
      'rules:.capa/imports/rule.md',
      'skills:.capa/imports/my-skill',
    ]);
  });

  it('migrates a referenced rule import into .config/capabilities/rules', async () => {
    mkdirSync(join(root, '.config'), { recursive: true });
    mkdirSync(join(root, '.capa', 'imports'), { recursive: true });
    writeFileSync(join(root, '.capa', 'imports', 'rule.md'), '# keep\n');
    writeFileSync(join(root, '.capa', 'imports', 'orphan.md'), '# leave\n');
    const capsPath = join(root, '.config', 'capabilities.yaml');
    writeFileSync(
      capsPath,
      [
        'skills: []',
        'servers: []',
        'tools: []',
        'rules:',
        '  - id: r1',
        '    type: local',
        '    path: ../.capa/imports/rule.md',
        '',
      ].join('\n'),
    );

    await ensureProjectUploadsMigrated(root);

    expect(existsSync(join(root, '.config', 'capabilities', 'rules', 'rule.md'))).toBe(
      true,
    );
    expect(existsSync(join(root, '.capa', 'imports', 'rule.md'))).toBe(false);
    expect(existsSync(join(root, '.capa', 'imports', 'orphan.md'))).toBe(true);

    const rewritten = readFileSync(capsPath, 'utf8');
    expect(rewritten).toContain('capabilities/rules/rule.md');
    expect(rewritten).not.toContain('.capa/imports/rule.md');
  });
});
