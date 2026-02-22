import { VERSION } from '../../version';

const GITHUB_API = 'https://api.github.com/repos/infragate/capa/releases/latest';

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
}

/**
 * Returns true if `latest` is strictly newer than `current` (ignores pre-release/build metadata).
 */
function isNewerVersion(current: string, latest: string): boolean {
  const base = (v: string) => v.split(/[-+]/)[0];
  const parts = (v: string) => base(v).split('.').map(n => parseInt(n, 10) || 0);

  const [cMaj, cMin, cPat] = parts(current);
  const [lMaj, lMin, lPat] = parts(latest);

  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/**
 * Check GitHub for the latest capa release.
 * Resolves to null if the check fails or times out.
 */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(GITHUB_API, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { tag_name?: string };
    const latestVersion = data.tag_name?.replace(/^v/, '');

    if (!latestVersion) return null;

    return {
      hasUpdate: isNewerVersion(VERSION, latestVersion),
      latestVersion,
      currentVersion: VERSION,
    };
  } catch {
    return null;
  }
}
