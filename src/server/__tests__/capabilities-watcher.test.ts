import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CapabilitiesFileWatcher } from '../capabilities-watcher';
import { EventEmitter } from 'events';
import * as filesystem from 'fs';
import * as paths from '../../shared/paths';

let root: string;
let watcher: CapabilitiesFileWatcher;
let changed: string[];
const log = { info: () => {}, warn: () => {}, debug: () => {} };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'capa-watcher-'));
  changed = [];
  watcher = new CapabilitiesFileWatcher(id => { changed.push(id); }, log);
});
afterEach(() => { watcher.stop(); rmSync(root, { recursive: true, force: true }); });
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(25);
  expect(predicate()).toBe(true);
}

it('reloads when the first config appears after watching an empty project', async () => {
  await watcher.watchProject('p', root);
  writeFileSync(join(root, 'capabilities.yaml'), 'providers: []');
  await until(() => changed.length === 1);
});

it('discovers nested folders created while the winning root config stays unchanged', async () => {
  const rootConfig = join(root, 'capabilities.yaml');
  writeFileSync(rootConfig, 'providers: []');
  await watcher.watchProject('p', root);
  mkdirSync(join(root, '.config'));
  await Bun.sleep(550);
  mkdirSync(join(root, '.config', 'capa'));
  await Bun.sleep(550);
  const nested = join(root, '.config', 'capa', 'config.yaml');
  writeFileSync(nested, 'providers: [codex]');
  await Bun.sleep(550);
  rmSync(rootConfig);
  await until(() => changed.length > 0);
  const before = changed.length;
  writeFileSync(nested, 'providers: [cursor]');
  await until(() => changed.length > before);
});

it('does not scan all config candidates during normal polling and stops cleanly', async () => {
  writeFileSync(join(root, 'capabilities.yaml'), 'providers: []');
  const detect = spyOn(paths, 'detectCapabilitiesFile');
  try {
    await watcher.watchProject('p', root);
    const before = detect.mock.calls.length;
    await Bun.sleep(1700);
    expect(detect.mock.calls.length).toBe(before);
    watcher.stop();
    writeFileSync(join(root, 'capabilities.yaml'), 'providers: [codex]');
    await Bun.sleep(550);
    expect(changed).toEqual([]);
  } finally { detect.mockRestore(); }
});

it('reloads on a format switch with matching mtimes and ignores marked self-writes', async () => {
  const yaml = join(root, 'capabilities.yaml');
  writeFileSync(yaml, 'providers: []');
  await watcher.watchProject('p', root);
  writeFileSync(join(root, 'capabilities.toml'), 'providers = []');
  await until(() => changed.length === 1);
  watcher.markSelfWrite('p');
  writeFileSync(join(root, 'capabilities.toml'), 'providers = ["codex"]');
  await Bun.sleep(650);
  expect(changed).toHaveLength(1);
});

it('rediscovers on unnamed events and repairs errored directory watches', async () => {
  const callbacks: Array<(event: string, filename: string | null) => void> = [];
  const handles: Array<EventEmitter & { close: ReturnType<typeof spyOn> | (() => void) }> = [];
  const watch = spyOn(filesystem, 'watch').mockImplementation(((_directory: string, callback: (event: string, filename: string | null) => void) => {
    callbacks.push(callback);
    const handle = Object.assign(new EventEmitter(), { close: () => {} });
    handles.push(handle);
    return handle;
  }) as never);
  try {
    await watcher.watchProject('p', root);
    writeFileSync(join(root, 'capabilities.yaml'), 'providers: []');
    callbacks[0]('rename', null);
    await until(() => changed.length === 1);
    handles[0].emit('error', new Error('watch interrupted'));
    await until(() => handles.length === 2);
    writeFileSync(join(root, 'capabilities.yaml'), 'providers: [codex]');
    callbacks[1]('change', 'capabilities.yaml');
    await until(() => changed.length === 2);
  } finally { watcher.stop(); watch.mockRestore(); }
});
