import { describe, expect, it } from 'bun:test';
import {
  buildFilePathTree,
  treeNodeIsDirectory,
  treeNodeIsFileLeaf,
} from './FileTree';

describe('buildFilePathTree', () => {
  it('renders strict prefix paths as folders when deeper paths exist', () => {
    const root = buildFilePathTree([
      'domains',
      'domains/attn-platform/AGENTS.md',
    ]);
    expect(treeNodeIsDirectory(root, 'domains')).toBe(true);
    expect(treeNodeIsFileLeaf(root, 'domains')).toBe(false);
    expect(treeNodeIsFileLeaf(root, 'domains/attn-platform/AGENTS.md')).toBe(true);
  });

  it('renders extensionless Grep roots as folders', () => {
    const root = buildFilePathTree(['domains/attn-platform/platform-core']);
    expect(treeNodeIsDirectory(root, 'domains/attn-platform/platform-core')).toBe(true);
    expect(treeNodeIsFileLeaf(root, 'domains/attn-platform/platform-core')).toBe(false);
  });

  it('keeps normal files as file leaves', () => {
    const root = buildFilePathTree(['src/foo.ts']);
    expect(treeNodeIsFileLeaf(root, 'src/foo.ts')).toBe(true);
  });
});
