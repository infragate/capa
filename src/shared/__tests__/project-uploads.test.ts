import { afterEach, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeProjectImport } from '../../server/project-fs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('uploads a new instruction without moving shared legacy assets or rewriting config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'capa-uploads-'));
  roots.push(root);
  mkdirSync(join(root, '.config'), { recursive: true });
  mkdirSync(join(root, '.capa', 'imports'), { recursive: true });
  const legacy = join(root, '.capa', 'imports', 'shared.md');
  writeFileSync(legacy, '# shared\n');
  const config = join(root, '.config', 'capabilities.yaml');
  const authored = `rules:
  - id: shared
    type: local
    path: ../.capa/imports/shared.md
agents:
  additional:
    - id: shared
      type: local
      path: ../.capa/imports/shared.md
`;
  writeFileSync(config, authored);
  const result = await writeProjectImport(root, { filename: 'base.md', bytes: new TextEncoder().encode('# new'), kind: 'instructions' });
  expect(result.path).toBe('capa/instructions/base.md');
  expect(readFileSync(config, 'utf8')).toBe(authored);
  expect(readFileSync(legacy, 'utf8')).toBe('# shared\n');
  expect(existsSync(join(root, '.config', 'capa', 'instructions', 'base.md'))).toBe(true);
});
