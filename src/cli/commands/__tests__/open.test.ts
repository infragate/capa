import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveDashboardUrl } from '../open';
import { generateProjectId } from '../../../shared/paths';
import { WORKSPACE_MARKER } from '../../../shared/workspaces/paths';

const SERVER = 'http://127.0.0.1:5912';

function dbWith(id: string) {
  return { getProject: (pid: string) => (pid === id ? ({ id } as any) : null) };
}

describe('resolveDashboardUrl', () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('opens the project page for a known project path', async () => {
    const id = generateProjectId('.');
    expect(await resolveDashboardUrl(SERVER, '.', dbWith(id))).toBe(`${SERVER}/ui/project?id=${id}`);
  });

  it('falls back to the dashboard home for an unknown path', async () => {
    const db = { getProject: () => null };
    expect(await resolveDashboardUrl(SERVER, './not-a-project', db)).toBe(`${SERVER}/`);
  });

  it('opens the real project from inside its wrap workspace', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'capa-open-'));
    const realProject = join(tmp, 'real-proj');
    const cacheRoot = join(tmp, 'real-proj-cursor-abc');
    const workingDir = join(cacheRoot, 'real-proj');
    mkdirSync(realProject, { recursive: true });
    mkdirSync(workingDir, { recursive: true });
    writeFileSync(
      join(cacheRoot, WORKSPACE_MARKER),
      JSON.stringify({
        realProjectPath: realProject,
        providerId: 'cursor',
        createdAt: new Date().toISOString(),
        cachePath: cacheRoot,
        workingDir: 'real-proj',
      }),
    );
    const id = generateProjectId(realProject);
    expect(await resolveDashboardUrl(SERVER, workingDir, dbWith(id))).toBe(
      `${SERVER}/ui/project?id=${id}`,
    );
  });
});
