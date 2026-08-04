import { describe, expect, it } from 'bun:test';
import {
  buildFilePathTree,
  treeNodeIsDirectory,
  treeNodeIsFileLeaf,
} from './FileTree';

describe('buildFilePathTree', () => {
  it('renders prefix paths as folders when deeper paths exist', () => {
    const root = buildFilePathTree([
      'domains',
      'domains/attn-platform/AGENTS.md',
    ]);
    expect(treeNodeIsDirectory(root, 'domains')).toBe(true);
    expect(treeNodeIsFileLeaf(root, 'domains')).toBe(false);
    expect(treeNodeIsFileLeaf(root, 'domains/attn-platform/AGENTS.md')).toBe(true);
  });

  it('renders Grep roots as folders via directoryPathKeys', () => {
    const root = buildFilePathTree(
      ['domains/attn-platform/platform-core'],
      ['domains/attn-platform/platform-core'],
    );
    expect(treeNodeIsDirectory(root, 'domains/attn-platform/platform-core')).toBe(true);
    expect(treeNodeIsFileLeaf(root, 'domains/attn-platform/platform-core')).toBe(false);
  });

  it('keeps extensionless files as selectable file leaves', () => {
    const root = buildFilePathTree(['Gemfile']);
    expect(treeNodeIsFileLeaf(root, 'Gemfile')).toBe(true);
  });

  it('keeps normal files as file leaves', () => {
    const root = buildFilePathTree(['src/foo.ts']);
    expect(treeNodeIsFileLeaf(root, 'src/foo.ts')).toBe(true);
  });
});
