import { afterEach, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildSymlinkWorkspace } from '../../../utils/wrap/symlink-workspace';
import { LockfileBuilder, emptyLockfile, loadLockfile, resolveLockfileLocation, serializeLockfile } from '../../../../shared/lockfile';
import { writeLockfileTask } from '../write-lockfile';
import type { InstallCtx } from '../context';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('wrap save and empty cleanup use the private root lock and leave real nested locks untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'capa-private-lock-'));
  roots.push(root);
  const real = join(root, 'real');
  const shadow = join(root, 'shadow');
  const configDir = join(real, '.config', 'capa');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.yaml'), 'providers: []');
  const original = serializeLockfile(emptyLockfile(), 'yaml');
  const realLock = join(configDir, 'capabilities.lock');
  writeFileSync(realLock, original);
  buildSymlinkWorkspace(real, shadow, []);
  const location = resolveLockfileLocation(shadow, { privateRoot: true });
  const builder = new LockfileBuilder(null);
  builder.setProviderConfig([{ provider: 'gemini-cli', configPath: '.gemini/settings.json', keyPath: ['context', 'fileName'], values: ['GEMINI.md'], createdKey: true }]);
  const ctx = { projectPath: shadow, lockfileLocation: location, lockBuilder: builder, capabilities: { skills: [], hooks: [] }, capabilitiesToUse: {} } as unknown as InstallCtx;
  await writeLockfileTask().task(ctx, {} as never);
  expect((await loadLockfile(shadow, location))?.providerConfig?.[0].provider).toBe('gemini-cli');
  expect(readFileSync(realLock, 'utf8')).toBe(original);
  ctx.lockBuilder = new LockfileBuilder(null);
  await writeLockfileTask().task(ctx, {} as never);
  expect(existsSync(location.path)).toBe(false);
  expect(readFileSync(realLock, 'utf8')).toBe(original);
});

it('ordinary empty cleanup deletes only the active lock', async () => {
  const root = mkdtempSync(join(tmpdir(), 'capa-active-lock-'));
  roots.push(root);
  mkdirSync(join(root, '.config', 'capa'), { recursive: true });
  writeFileSync(join(root, '.config', 'capa', 'config.yaml'), 'providers: []');
  const location = resolveLockfileLocation(root);
  writeFileSync(location.path, serializeLockfile(emptyLockfile(), 'yaml'));
  const orphan = join(root, 'capabilities.lock');
  writeFileSync(orphan, 'unrelated');
  await writeLockfileTask().task({ projectPath: root, lockfileLocation: location, lockBuilder: new LockfileBuilder(null), capabilities: { skills: [] }, capabilitiesToUse: {} } as unknown as InstallCtx, {} as never);
  expect(existsSync(location.path)).toBe(false);
  expect(readFileSync(orphan, 'utf8')).toBe('unrelated');
});
