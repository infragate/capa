import { describe, it, expect } from 'bun:test';
import { LFS_SKIP_ARGS, gitCommandArgs } from '../git-cli';

describe('git-cli', () => {
  it('prepends LFS skip flags on clone --mirror', () => {
    expect(gitCommandArgs(['clone', '--mirror', 'https://example.com/repo.git', '/tmp/mirror'])).toEqual([
      ...LFS_SKIP_ARGS,
      'clone',
      '--mirror',
      'https://example.com/repo.git',
      '/tmp/mirror',
    ]);
  });

  it('prepends LFS skip flags on worktree add', () => {
    const args = gitCommandArgs([
      '-C',
      '/tmp/mirror',
      'worktree',
      'add',
      '--detach',
      '--force',
      '/tmp/snap',
      'abc123',
    ]);
    expect(args.slice(0, 8)).toEqual(LFS_SKIP_ARGS);
    expect(args).toContain('worktree');
    expect(args).toContain('add');
  });
});
