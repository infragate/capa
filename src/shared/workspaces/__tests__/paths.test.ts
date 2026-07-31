import { describe, it, expect } from 'bun:test';
import { join } from 'path';
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
});
