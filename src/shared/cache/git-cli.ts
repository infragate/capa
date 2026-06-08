import { execFile, type ExecFileOptions } from 'child_process';
import { promisify } from 'util';

/** Git -c flags that disable LFS smudge/clean so clones work without git-lfs or LFS API access. */
export const LFS_SKIP_ARGS = [
  '-c',
  'filter.lfs.smudge=',
  '-c',
  'filter.lfs.clean=',
  '-c',
  'filter.lfs.process=',
  '-c',
  'filter.lfs.required=false',
];

const execFileAsync = promisify(execFile);

/**
 * Run git with LFS filters disabled. Skills only need text files (SKILL.md, etc.),
 * never LFS-backed binary blobs.
 */
export function gitCommandArgs(args: string[]): string[] {
  return [...LFS_SKIP_ARGS, ...args];
}

export async function git(
  args: string[],
  opts: ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', gitCommandArgs(args), {
    ...opts,
    env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1', ...(opts.env ?? {}) },
  });
  return { stdout: String(stdout), stderr: String(stderr) };
}
