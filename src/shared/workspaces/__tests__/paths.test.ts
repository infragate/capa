import { describe, it, expect } from 'bun:test';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { getWorkspacesDir, isUnderWrapWorkspacesDir } from '../paths';

describe('isUnderWrapWorkspacesDir', () => {
  it('returns true for the workspaces root and nested paths', () => {
    const root = getWorkspacesDir();
    expect(isUnderWrapWorkspacesDir(root)).toBe(true);
    expect(isUnderWrapWorkspacesDir(join(root, 'proj-claude-abc', 'proj'))).toBe(true);
  });

  it('returns false for unrelated paths', () => {
    expect(isUnderWrapWorkspacesDir(tmpdir())).toBe(false);
    expect(isUnderWrapWorkspacesDir(join(tmpdir(), 'some-project'))).toBe(false);
  });

  it('returns false for a sibling path that only shares a prefix', () => {
    const root = getWorkspacesDir();
    expect(isUnderWrapWorkspacesDir(`${root}2`)).toBe(false);
    expect(isUnderWrapWorkspacesDir(`${root}-other`)).toBe(false);
  });

  it('treats Windows drive-letter casing as the same location', () => {
    if (process.platform !== 'win32') return;
    const root = resolve(getWorkspacesDir());
    const flipped = root.replace(/^([A-Za-z]):/, (_, d: string) =>
      d === d.toUpperCase() ? `${d.toLowerCase()}:` : `${d.toUpperCase()}:`,
    );
    expect(isUnderWrapWorkspacesDir(join(flipped, 'shadow', 'proj'))).toBe(true);
  });

  it('treats macOS /tmp and /private/tmp as the same location', () => {
    if (process.platform !== 'darwin') return;
    const root = getWorkspacesDir();
    if (!root.startsWith('/tmp/')) return;
    const privateRoot = root.replace(/^\/tmp\//, '/private/tmp/');
    expect(isUnderWrapWorkspacesDir(join(privateRoot, 'shadow', 'proj'))).toBe(true);
  });
});
