import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { getWrappableProvider } from '../../../../shared/providers';
import { WORKSPACE_MARKER } from '../../../../shared/workspaces/paths';

const installMock = mock(async () => {});

mock.module('../../../commands/install', () => ({
  installCommand: installMock,
}));

const { prepareWorkspace, computeCapabilitiesFingerprint, workspaceDirName, workingDirName } =
  await import('../workspace');

function isolateHome(): { home: string; restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'capa-ws-home-'));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    home,
    restore: () => {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

describe('prepareWorkspace', () => {
  let realDir: string;
  let homeCtx: { home: string; restore: () => void };

  beforeEach(() => {
    realDir = mkdtempSync(join(tmpdir(), 'capa-ws-real-'));
    homeCtx = isolateHome();
    writeFileSync(
      join(realDir, 'capabilities.yaml'),
      'skills: []\nproviders:\n  - claude-code\n',
    );
    mkdirSync(join(realDir, 'src'));
    writeFileSync(join(realDir, 'src', 'x.ts'), '');
    installMock.mockClear();
    installMock.mockImplementation(async () => {});
  });

  afterEach(() => {
    homeCtx.restore();
    rmSync(realDir, { recursive: true, force: true });
  });

  it('cold prepare nests the original project name under the cache slug', async () => {
    const provider = getWrappableProvider('claude-code')!;
    const prepared = await prepareWorkspace(realDir, provider);

    expect(prepared.cold).toBe(true);
    expect(basename(prepared.workspacePath)).toBe(workingDirName(realDir));
    expect(basename(prepared.workspacePath)).toBe(basename(realDir));
    expect(prepared.cachePath).toBe(join(prepared.workspacePath, '..'));
    expect(existsSync(join(prepared.cachePath, WORKSPACE_MARKER))).toBe(true);
    expect(existsSync(join(prepared.workspacePath, WORKSPACE_MARKER))).toBe(false);
    const marker = JSON.parse(
      readFileSync(join(prepared.cachePath, WORKSPACE_MARKER), 'utf8'),
    );
    expect(marker.providerId).toBe('claude-code');
    expect(marker.cachePath).toBe(prepared.cachePath);
    expect(marker.workingDir).toBe(basename(realDir));
    // Marker must not appear inside the IDE-visible working directory.
    expect(existsSync(join(prepared.workspacePath, WORKSPACE_MARKER))).toBe(false);
    expect(existsSync(join(prepared.cachePath, WORKSPACE_MARKER))).toBe(true);
    expect(installMock).toHaveBeenCalledTimes(1);
    const args = installMock.mock.calls.at(0) as unknown as [
      { projectPath: string; identityPath: string; provider: string },
    ];
    expect(args[0].projectPath).toBe(prepared.workspacePath);
    expect(args[0].identityPath).toBe(realDir);
    expect(args[0].provider).toBe('claude-code');
  });

  it('second prepare with same fingerprint skips install when DB has project', async () => {
    const provider = getWrappableProvider('claude-code')!;

    const { CapaDatabase } = await import('../../../../db/database');
    const { loadSettings, getDatabasePath, ensureCapaDir } = await import(
      '../../../../shared/config'
    );
    const { generateProjectId } = await import('../../../../shared/paths');
    await ensureCapaDir();
    const settings = await loadSettings();
    const db = new CapaDatabase(getDatabasePath(settings));
    db.upsertProject({ id: generateProjectId(realDir), path: realDir });
    db.close();

    const first = await prepareWorkspace(realDir, provider);
    expect(first.cold).toBe(true);
    expect(installMock).toHaveBeenCalledTimes(1);

    installMock.mockClear();
    const second = await prepareWorkspace(realDir, provider);
    expect(second.cold).toBe(false);
    expect(second.workspacePath).toBe(first.workspacePath);
    expect(second.cachePath).toBe(first.cachePath);
    expect(installMock).not.toHaveBeenCalled();
  });

  it('fingerprint changes when capabilities.yaml changes', async () => {
    const a = await computeCapabilitiesFingerprint(realDir);
    writeFileSync(
      join(realDir, 'capabilities.yaml'),
      'skills:\n  - id: x\n    type: inline\n    def:\n      content: hi\n',
    );
    const b = await computeCapabilitiesFingerprint(realDir);
    expect(a).not.toBe(b);
    expect(workspaceDirName(realDir, 'claude-code', a)).not.toBe(
      workspaceDirName(realDir, 'claude-code', b),
    );
  });
});
