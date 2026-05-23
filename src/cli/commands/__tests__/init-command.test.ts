import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createDefaultCapabilities,
  parseCapabilitiesFile,
} from '../../../shared/capabilities';

const ensureServerMock = mock(async () => ({
  running: true,
  url: 'http://127.0.0.1:5912',
}));

mock.module('../../utils/server-manager', () => ({
  ensureServer: ensureServerMock,
  startServer: mock(async () => {}),
  stopServer: mock(async () => {}),
  getServerStatus: mock(async () => ({ running: false, url: undefined, pid: undefined })),
  restartServer: mock(async () => {}),
}));

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
  });

  afterEach(() => {
    process.chdir(originalCwd);
    homeCtx.restore();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('module loads and exports initCommand', () => {
    expect(typeof initCommand).toBe('function');
  });

  it('writes a default capabilities.yaml with the expected shape', async () => {
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
  });

  afterAll(() => {
    mock.restore();
  });
});
