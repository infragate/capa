import { describe, it, expect } from 'bun:test';
import { explainGitError } from '../git';

describe('explainGitError', () => {
  it('maps "terminal prompts disabled" to an access error mentioning the repo', () => {
    // This is exactly what git emits once GIT_TERMINAL_PROMPT=0 stops it from
    // hanging on an interactive credential prompt for a private repo.
    const err = {
      stderr:
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    };
    const out = explainGitError(err, 'github', 'owner/private-repo', false);

    // Must be actionable, not a hang. For the no-auth case it should point the
    // user at connecting the integration.
    expect(out.message).toContain('owner/private-repo');
    expect(out.message).toMatch(/private or does not exist/i);
    // Keep the substrings install-one-skill keys off to append an integrations link.
    expect(out.message).toMatch(/authentication failed/i);
    expect(out.message).toMatch(/not accessible/i);
  });

  it('gives a token-focused hint when auth is configured but still fails', () => {
    const err = { stderr: 'remote: Authentication failed for ...' };
    const out = explainGitError(err, 'gitlab', 'group/proj', true);
    expect(out.message).toMatch(/token may be expired or lacks access/i);
  });

  it('detects a missing git binary', () => {
    const out = explainGitError({ code: 'ENOENT' }, 'github', 'a/b', false);
    expect(out.message).toMatch(/git is not installed/i);
  });

  it('detects a not-found / no-permission repo', () => {
    const err = { stderr: "fatal: repository 'https://github.com/a/b' not found" };
    const out = explainGitError(err, 'github', 'a/b', false);
    expect(out.message).toMatch(/not accessible/i);
  });

  it('detects a network failure', () => {
    const err = { stderr: 'fatal: unable to access ... Could not resolve host: github.com' };
    const out = explainGitError(err, 'github', 'a/b', true);
    expect(out.message).toMatch(/network error/i);
  });
});
