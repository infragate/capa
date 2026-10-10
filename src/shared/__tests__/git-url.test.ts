import { describe, it, expect } from 'bun:test';
import { gitRepoKey, isGitUrl, parseGitUrlSource } from '../git-url';
import { parseSkillSource } from '../../cli/commands/add-parse-skill';
import { parsePluginSource } from '../../cli/commands/add-parse-plugin';
import { validatePluginDef } from '../plugin-source';

describe('parseGitUrlSource', () => {
  it('drops http credentials so they never reach capabilities.yaml', () => {
    expect(parseGitUrlSource('https://user:token@git.example.com/team/skills.git:v1.0.0')).toMatchObject({
      url: 'https://git.example.com/team/skills.git',
      version: 'v1.0.0',
    });
    // new URL() rejects this (bad port), the token must still go.
    expect(parseGitUrlSource('https://user:token@git.example.com:bad/team/skills.git')?.url).toBe(
      'https://git.example.com:bad/team/skills.git',
    );
    expect(parseGitUrlSource('ssh://git@git.example.com/team/skills.git')?.url).toBe(
      'ssh://git@git.example.com/team/skills.git',
    );
  });

  it('takes any host, including @ in the path and a port', () => {
    expect(parseGitUrlSource('https://git.example.com:8443/@acme/code-review.git')).toEqual({
      url: 'https://git.example.com:8443/@acme/code-review.git',
      idHint: 'code-review',
    });
  });

  it('parses ::path, :version and #sha suffixes', () => {
    expect(parseGitUrlSource('https://h.test/team/skills.git::skills/lint:v1.2.0')).toEqual({
      url: 'https://h.test/team/skills.git',
      path: 'skills/lint',
      version: 'v1.2.0',
      idHint: 'lint',
    });
    expect(parseGitUrlSource('https://h.test/team/skills.git#abc1234')).toMatchObject({
      url: 'https://h.test/team/skills.git',
      ref: 'abc1234',
    });
  });

  it('rejects URLs that are not clone URLs', () => {
    expect(isGitUrl('https://example.com/SKILL.md')).toBe(false);
    expect(isGitUrl('https://example.com/a.github.io/page')).toBe(false);
    expect(isGitUrl('owner/repo')).toBe(false);
  });
});

describe('gitRepoKey', () => {
  it('is host plus path plus a URL hash, safe for Windows directory names', () => {
    expect(gitRepoKey('https://git.example.com/@acme/code-review.git')).toMatch(
      /^git\.example\.com\/@acme\/code-review-[0-9a-f]{12}$/,
    );
    expect(gitRepoKey('http://localhost:8080/a/b.git')).toMatch(/^localhost_8080\/a\/b-[0-9a-f]{12}$/);
    expect(gitRepoKey('https://h.test/a/../../etc.git')).not.toContain('..');
  });

  it('never shares a key between different URLs', () => {
    const keys = new Set(
      [
        'https://localhost/a/b.git',
        'http://localhost/a/b.git',
        'https://h.test:8443/a/b.git',
        'https://h.test/a:b.git',
        'https://h.test/a_b.git',
      ].map(gitRepoKey),
    );
    expect(keys.size).toBe(5);
  });

  it('ignores credentials in the URL', () => {
    expect(gitRepoKey('https://user:secret@h.test/a/b.git')).toBe(gitRepoKey('https://h.test/a/b.git'));
  });

  it('accepts ssh clone URLs', () => {
    expect(gitRepoKey('ssh://git@h.test/a/b.git')).toMatch(/^h\.test\/a\/b-[0-9a-f]{12}$/);
    expect(parseGitUrlSource('ssh://git@h.test/a/b.git:v1.0.0')).toMatchObject({
      url: 'ssh://git@h.test/a/b.git',
      version: 'v1.0.0',
    });
  });

  it('allows plain http only to this machine', () => {
    expect(() => gitRepoKey('http://git.example.com/a/b.git')).toThrow(/only allowed for localhost/);
    expect(() => gitRepoKey('http://user:s3cret@github.com/a/b.git')).toThrow(/^(?!.*s3cret)/);
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(() => gitRepoKey(`http://${host}:8080/a/b.git`)).not.toThrow();
    }
  });

  it('rejects git helper transports that run commands', () => {
    expect(() => gitRepoKey('ext::sh -c touch% /tmp/pwned')).toThrow(/Unsupported git URL scheme/);
    expect(() => gitRepoKey('fd::17/foo.git')).toThrow(/Unsupported git URL scheme/);
    expect(() => gitRepoKey('--upload-pack=touch /tmp/pwned')).toThrow();
  });
});

describe('plugin schema', () => {
  it('requires the source field that matches the type', async () => {
    const { normalizeCapabilities } = await import('../capabilities');
    expect(() => normalizeCapabilities({ plugins: [{ id: 'p', type: 'git', def: {} }] })).toThrow(/def\.url/);
    expect(() => normalizeCapabilities({ plugins: [{ id: 'p', type: 'github', def: {} }] })).toThrow(/def\.repo/);
    expect(
      normalizeCapabilities({ plugins: [{ id: 'p', type: 'git', def: { url: 'https://h.test/p.git' } }] }).plugins,
    ).toHaveLength(1);
  });
});

describe('capa add with a git clone URL', () => {
  it('makes a git skill, not a raw remote file', async () => {
    expect(await parseSkillSource('https://h.test/@acme/code-review.git:v1.0.0')).toEqual({
      id: 'code-review',
      type: 'git',
      def: { url: 'https://h.test/@acme/code-review.git', version: 'v1.0.0' },
    });
  });

  it('keeps raw SKILL.md URLs as remote', async () => {
    expect((await parseSkillSource('https://h.test/skills/SKILL.md')).type).toBe('remote');
  });

  it('makes a git plugin that validates', () => {
    const parsed = parsePluginSource('https://h.test/@acme/tools.git::plugins/deploy');
    expect(parsed).toEqual({
      type: 'git',
      def: { url: 'https://h.test/@acme/tools.git', subpath: 'plugins/deploy' },
      idHint: 'deploy',
    });
    expect(validatePluginDef({ type: 'git', def: parsed.def })).toMatchObject({
      platform: 'git',
      repoPath: gitRepoKey('https://h.test/@acme/tools.git'),
      subpath: 'plugins/deploy',
      repoUrl: 'https://h.test/@acme/tools.git',
    });
  });

  it('keeps credentials in the URL out of the validated (locked, printed) plugin URL', () => {
    expect(
      validatePluginDef({ type: 'git', def: { url: 'https://user:s3cret@h.test/acme/tools.git' } }),
    ).toMatchObject({ repoUrl: 'https://h.test/acme/tools.git' });
    expect(validatePluginDef({ type: 'git', def: { url: 'http://h.test/acme/tools.git' } })).toMatchObject({
      error: expect.stringMatching(/only allowed for localhost/),
    });
  });

  it('still parses GitHub URLs as github', () => {
    expect(parsePluginSource('https://github.com/owner/repo.git').type).toBe('github');
  });
});
