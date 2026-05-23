import { exec } from 'child_process';
import { promisify } from 'util';
import { getGitProvider } from '../../../../shared/git-providers/registry';
import type { CachePlatform } from '../../../../shared/cache';

const execAsync = promisify(exec);

export async function checkGitInstalled(): Promise<boolean> {
  try {
    await execAsync('git --version');
    return true;
  } catch {
    return false;
  }
}

export function gitOAuthHelpText(): string {
  return (
    'CAPA requires Git to clone repositories and install skills.\n\n' +
    'Please install Git:\n' +
    '• Windows: https://git-scm.com/download/win\n' +
    '• macOS:   brew install git  (or download from https://git-scm.com)\n' +
    '• Linux:   sudo apt install git  (Ubuntu/Debian)\n' +
    '           sudo yum install git  (CentOS/RHEL)\n\n' +
    'After installing Git, run: capa install'
  );
}

// Returns short, actionable messages; callers wrap them into the per-skill
// error block which already prefixes `Skill "<id>" failed:`.
export function explainGitError(
  error: any,
  platform: CachePlatform,
  repoPath: string,
  hasAuth: boolean
): Error {
  const errorMessage: string = error?.stderr || error?.message || '';
  const platformName = getGitProvider(platform)?.displayName ?? platform;
  const repoUrl = `https://${platform}.com/${repoPath}`;

  if (
    errorMessage.includes('git: command not found') ||
    errorMessage.includes("'git' is not recognized") ||
    errorMessage.includes('git: not found') ||
    error?.code === 'ENOENT'
  ) {
    return new Error('Git is not installed — install git and re-run `capa install` (https://git-scm.com/downloads).');
  }

  if (
    errorMessage.includes('could not be found') ||
    errorMessage.includes('not found') ||
    errorMessage.includes("don't have permission")
  ) {
    const hint = hasAuth
      ? `Check the path, or ensure your ${platformName} token has access.`
      : `Check the path, or connect ${platformName} if the repo is private.`;
    return new Error(`${platformName} repository not accessible: ${repoPath}\n${repoUrl}\n${hint}`);
  }

  if (
    errorMessage.includes('Authentication failed') ||
    errorMessage.includes('could not read Username')
  ) {
    return new Error(`${platformName} authentication failed — token may be expired; reconnect in the integrations page.`);
  }

  if (
    errorMessage.includes('unable to access') ||
    errorMessage.includes('Could not resolve host')
  ) {
    return new Error(`Network error: cannot reach ${platform}.com — check your internet connection.`);
  }

  const fatal =
    errorMessage.split('\n').find((line: string) => line.includes('fatal:') || line.includes('error:')) ||
    'Unknown error';
  return new Error(`Failed to clone ${repoUrl}: ${fatal}`);
}
