import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolvePassthroughCapabilitiesPath } from '../env';

describe('resolvePassthroughCapabilitiesPath', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'capa-passthrough-caps-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('falls back to root capabilities.yaml when none exist', async () => {
    expect(await resolvePassthroughCapabilitiesPath(projectDir)).toBe(
      join(projectDir, 'capabilities.yaml'),
    );
  });

  it('returns the discovered .config capabilities path', async () => {
    mkdirSync(join(projectDir, '.config'), { recursive: true });
    const path = join(projectDir, '.config', 'capabilities.yaml');
    writeFileSync(path, 'providers: []\n');
    expect(await resolvePassthroughCapabilitiesPath(projectDir)).toBe(path);
  });
});
