import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const installMock = mock(async () => {});

mock.module('../install', () => ({
  installCommand: installMock,
}));

const { addCommand } = await import('../add');

function isolateHome(): { restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'capa-add-home-'));
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

describe('addCommand install flag (github skill)', () => {
  let projectDir: string;
  let homeCtx: { restore: () => void };
  let originalCwd: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'capa-add-proj-'));
    homeCtx = isolateHome();
    originalCwd = process.cwd();
    process.chdir(projectDir);
    writeFileSync(
      join(projectDir, 'capabilities.yaml'),
      'skills: []\nplugins: []\nservers: []\ntools: []\n',
    );
    installMock.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    homeCtx.restore();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('does not call installCommand without --install', async () => {
    await addCommand('owner/repo@my-skill', {});
    expect(installMock).not.toHaveBeenCalled();
    const yaml = readFileSync(join(projectDir, 'capabilities.yaml'), 'utf8');
    expect(yaml).toContain('my-skill');
  });

  it('calls installCommand with --install', async () => {
    await addCommand('owner/repo@my-skill', { install: true });
    expect(installMock).toHaveBeenCalled();
  });
});
