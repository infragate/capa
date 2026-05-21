/** Percent-decode a single ref segment, tolerant of malformed encodings. */
export function decodeRefSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

export function splitGithubRefAndPath(
  tail: string[]
): { ref: string; path: string } | null {
  if (
    tail.length >= 4 &&
    tail[0] === 'refs' &&
    (tail[1] === 'heads' || tail[1] === 'tags')
  ) {
    const ref = decodeRefSegment(tail[2]);
    const path = tail.slice(3).join('/');
    if (!ref || !path) return null;
    return { ref, path };
  }
  if (tail.length < 2) return null;
  const ref = decodeRefSegment(tail[0]);
  const path = tail.slice(1).join('/');
  if (!ref || !path) return null;
  return { ref, path };
}

export function refSuffix(ref: string): string {
  if (!ref || ref === 'HEAD' || ref === 'main' || ref === 'master') return '';
  if (/^[0-9a-f]{7,40}$/i.test(ref)) {
    return `#${ref}`;
  }
  return `:${ref}`;
}

export function splitTreeRefAndSubpath(treePath: string): { refOrBranch: string; subpath?: string } {
  const segments = treePath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { refOrBranch: '' };
  }

  const pluginRootIndex = segments.findIndex((segment) => segment === 'plugins');
  if (pluginRootIndex > 0) {
    return {
      refOrBranch: segments.slice(0, pluginRootIndex).join('/'),
      subpath: segments.slice(pluginRootIndex).join('/'),
    };
  }

  if (segments.length > 1) {
    throw new Error(
      `Ambiguous plugin tree URL path "${treePath}". ` +
      `For tree URLs, capa only auto-splits when the plugin path starts with "plugins/". ` +
      `Use "owner/repo::path/to/plugin" or "gitlab:group/project::path/to/plugin" syntax to disambiguate.`
    );
  }

  return {
    refOrBranch: segments[0],
    subpath: undefined,
  };
}

export function parseGithubRawUrl(url: string): { owner: string; repo: string; ref: string; path: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (host === 'raw.githubusercontent.com') {
    if (segments.length < 4) return null;
    const [owner, repo, ...rest] = segments;
    const split = splitGithubRefAndPath(rest);
    if (!split) return null;
    return { owner, repo, ref: split.ref, path: split.path };
  }

  if (host === 'github.com') {
    const rawIdx = segments.indexOf('raw');
    if (rawIdx === -1 || rawIdx < 2 || segments.length < rawIdx + 3) return null;
    const owner = segments[0];
    const repo = segments[1];
    const split = splitGithubRefAndPath(segments.slice(rawIdx + 1));
    if (!owner || !repo || !split) return null;
    return { owner, repo, ref: split.ref, path: split.path };
  }

  return null;
}

export function parseGitlabRawUrl(url: string): { owner: string; repo: string; ref: string; path: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== 'gitlab.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const sepIdx = segments.indexOf('-');
  if (sepIdx === -1 || sepIdx < 2) return null;
  if (segments[sepIdx + 1] !== 'raw') return null;
  if (segments.length < sepIdx + 4) return null;

  const ownerRepo = segments.slice(0, sepIdx).join('/');
  const ref = segments[sepIdx + 2];
  const filepath = segments.slice(sepIdx + 3).join('/');
  if (!ownerRepo || !ref || !filepath) return null;

  return { owner: ownerRepo, repo: '', ref, path: filepath };
}

export function parseGithubRepoUrl(url: string): { owner: string; repo: string; ref?: string; path?: string } | null {
  const m = url.match(
    /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w./-]+))?$/
  );
  if (!m) return null;
  const [, owner, repo, treePath] = m;
  if (treePath) {
    const { refOrBranch, subpath } = splitTreeRefAndSubpath(treePath);
    return { owner, repo, ref: refOrBranch, path: subpath };
  }
  return { owner, repo };
}

export function parseGitlabRepoUrl(url: string): { owner: string; repo: string; ref?: string; path?: string } | null {
  const m = url.match(
    /^https?:\/\/gitlab\.com\/([\w.-]+(?:\/[\w.-]+)+?)(?:\.git)?(?:\/-\/tree\/([\w./-]+))?$/
  );
  if (!m) return null;
  const [, repoPath, treePath] = m;
  const repoSegments = repoPath.split('/');
  const repo = repoSegments[repoSegments.length - 1];
  if (treePath) {
    const { refOrBranch, subpath } = splitTreeRefAndSubpath(treePath);
    return { owner: repoPath, repo, ref: refOrBranch, path: subpath };
  }
  return { owner: repoPath, repo };
}
