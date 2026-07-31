import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readWorkspaceMarker, refuseIfWrapWorkspace } from '../marker';
import { WORKSPACE_MARKER } from '../../../../shared/workspaces/paths';

describe('readWorkspaceMarker', () => {
  let homeish: string;
  let cacheRoot: string;
  let workingDir: string;

  beforeEach(() => {
    homeish = mkdtempSync(join(tmpdir(), 'capa-marker-'));
    cacheRoot = join(homeish, 'proj-cursor-abc');
    workingDir = join(cacheRoot, 'proj');
    mkdirSync(workingDir, { recursive: true });
    writeFileSync(
      join(cacheRoot, WORKSPACE_MARKER),
      JSON.stringify({
        realProjectPath: '/real/proj',
        providerId: 'cursor',
        createdAt: new Date().toISOString(),
        cachePath: cacheRoot,
        workingDir: 'proj',
      }) + '\n',
    );
  });

  afterEach(() => {
    rmSync(homeish, { recursive: true, force: true });
  });

  it('detects the nested working directory', async () => {
    const marker = await readWorkspaceMarker(workingDir);
    expect(marker?.providerId).toBe('cursor');
    expect(marker?.workingDir).toBe('proj');
  });

  it('detects a subdirectory inside the nested working directory', async () => {
    const nested = join(workingDir, 'src', 'lib');
    mkdirSync(nested, { recursive: true });
    const marker = await readWorkspaceMarker(nested);
    expect(marker?.providerId).toBe('cursor');
    expect(marker?.realProjectPath).toBe('/real/proj');
  });

  it('detects the cache root itself', async () => {
    const marker = await readWorkspaceMarker(cacheRoot);
    expect(marker?.providerId).toBe('cursor');
  });

  it('returns null outside a wrap workspace', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'capa-outside-'));
    try {
      expect(await readWorkspaceMarker(outside)).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuseIfWrapWorkspace returns true from a subdirectory', async () => {
    const nested = join(workingDir, 'deep');
    mkdirSync(nested, { recursive: true });
    const prev = process.cwd();
    try {
      process.chdir(nested);
      expect(await refuseIfWrapWorkspace('install')).toBe(true);
    } finally {
      process.chdir(prev);
    }
  });
});
