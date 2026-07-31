import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createDefaultCapabilities,
  parseCapabilitiesFile,
  writeCapabilitiesFile,
} from '../../../shared/capabilities';
import { generateProjectId } from '../../../shared/paths';
import { getDatabasePath, loadSettings } from '../../../shared/config';
import { CapaDatabase } from '../../../db/database';

const ensureServerMock = mock(async () => ({
  running: true,
  url: 'http://127.0.0.1:5912',
}));

const fetchMock = mock(async () => ({
  ok: true,
  statusText: 'OK',
  text: async () => '{}',
}));

mock.module('../../utils/server-manager', () => ({
  ensureServer: ensureServerMock,
  startServer: mock(async () => {}),
  stopServer: mock(async () => {}),
  getServerStatus: mock(async () => ({ running: false, url: undefined, pid: undefined })),
  restartServer: mock(async () => {}),
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { initCommand } = await import('../init');

function isolateHome(): { restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'capa-init-home-'));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    restore: () => {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

describe('initCommand', () => {
  let projectDir: string;
  let homeCtx: { restore: () => void };
  let originalCwd: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'capa-init-project-'));
    homeCtx = isolateHome();
    originalCwd = process.cwd();
    process.chdir(projectDir);
    ensureServerMock.mockClear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    homeCtx.restore();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('module loads and exports initCommand', () => {
    expect(typeof initCommand).toBe('function');
  });

  it('writes a default capabilities.yaml and registers the project', async () => {
    const capabilitiesPath = join(projectDir, 'capabilities.yaml');
    expect(existsSync(capabilitiesPath)).toBe(false);

    await initCommand('yaml');

    expect(existsSync(capabilitiesPath)).toBe(true);
    const parsed = await parseCapabilitiesFile(capabilitiesPath, 'yaml');
    const expected = createDefaultCapabilities();

    expect(parsed.options).toEqual(expected.options);
    expect(parsed.skills).toEqual(expected.skills);
    expect(parsed.servers).toEqual([]);
    expect(parsed.tools).toEqual([]);
    expect(ensureServerMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();

    const projectId = generateProjectId(projectDir);
    const settings = await loadSettings();
    const db = new CapaDatabase(getDatabasePath(settings));
    try {
      const project = db.getProject(projectId);
      expect(project).not.toBeNull();
      expect(project!.path).toBe(projectDir);
    } finally {
      db.close();
    }
  });

  it('registers an existing capabilities file without recreating it', async () => {
    const capabilitiesPath = join(projectDir, 'capabilities.yaml');
    const custom = createDefaultCapabilities();
    custom.skills = [
      { id: 'custom-skill', type: 'inline', def: { content: '# Custom\n', description: 'test' } },
    ];
    await writeCapabilitiesFile(capabilitiesPath, 'yaml', custom);
    const before = await Bun.file(capabilitiesPath).text();

    await initCommand('yaml');

    const after = await Bun.file(capabilitiesPath).text();
    expect(after).toBe(before);
    expect(ensureServerMock).toHaveBeenCalled();

    const projectId = generateProjectId(projectDir);
    const settings = await loadSettings();
    const db = new CapaDatabase(getDatabasePath(settings));
    try {
      expect(db.getProject(projectId)).not.toBeNull();
    } finally {
      db.close();
    }
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });
});
