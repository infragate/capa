import { describe, it, expect } from 'bun:test';
import {
  getGitProvider,
  getGitProviderByHost,
  parseGitRawUrl,
} from '../registry';

describe('git provider registry', () => {
  it('getGitProvider("github") returns the github entry', () => {
    const gp = getGitProvider('github');
    expect(gp).toBeDefined();
    expect(gp!.id).toBe('github');
    expect(gp!.host).toBe('github.com');
    expect(gp!.displayName).toBe('GitHub');
  });

  it('getGitProviderByHost("github.com") returns github', () => {
    const gp = getGitProviderByHost('github.com');
    expect(gp?.id).toBe('github');
  });

  it('parseGitRawUrl parses GitHub raw URLs', () => {
    const result = parseGitRawUrl(
      'https://raw.githubusercontent.com/foo/bar/main/README.md'
    );
    expect(result).not.toBeNull();
    expect(result!.provider.id).toBe('github');
    expect(result!.owner).toBe('foo');
    expect(result!.repo).toBe('bar');
    expect(result!.ref).toBe('main');
    expect(result!.path).toBe('README.md');
  });

  it('parseGitRawUrl parses GitLab raw URLs', () => {
    const result = parseGitRawUrl(
      'https://gitlab.com/foo/bar/-/raw/main/README.md'
    );
    expect(result).not.toBeNull();
    expect(result!.provider.id).toBe('gitlab');
    expect(result!.owner).toBe('foo/bar');
    expect(result!.repo).toBe('');
    expect(result!.ref).toBe('main');
    expect(result!.path).toBe('README.md');
  });

  it('parseGitRawUrl returns null for unknown URLs', () => {
    expect(parseGitRawUrl('https://example.com/file.md')).toBeNull();
  });
});
