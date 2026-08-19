import { createHash } from 'crypto';

export const GITHUB_REPO = 'infragate/capa';
export const CHECKSUMS_ASSET = 'SHA256SUMS.txt';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export type InstallerAsset = 'install.sh' | 'install.ps1';

export interface UpgradePlan {
  tag: string;
  version: string;
  installerAsset: InstallerAsset;
  installerUrl: string;
  installerDigest: string;
  checksumsUrl: string;
  binaryAsset: string;
  binaryDigest: string;
}

export interface PlanUpgradeOptions {
  fetchText: (url: string) => Promise<string>;
  platform?: NodeJS.Platform | string;
  arch?: string;
}

export function normalizeReleaseTag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) {
    throw new Error('release tag is empty');
  }
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

export function githubReleaseAssetUrl(tag: string, asset: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/download/${normalizeReleaseTag(tag)}/${asset}`;
}

export function installerAssetFor(platform: string): InstallerAsset {
  return platform === 'win32' ? 'install.ps1' : 'install.sh';
}

export function binaryAssetFor(platform: string, arch: string): string {
  const cpu =
    arch === 'x64' || arch === 'x86_64' || arch === 'amd64'
      ? 'x86_64'
      : arch === 'arm64' || arch === 'aarch64'
        ? 'aarch64'
        : arch === 'ia32' || arch === 'x86' || arch === 'i686'
          ? 'i686'
          : arch;

  if (platform === 'win32') {
    const winCpu = cpu === 'aarch64' ? 'x86_64' : cpu;
    return `capa-${winCpu}-pc-windows-msvc.exe`;
  }

  const os = platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-gnu';
  return `capa-${cpu}-${os}`;
}

export function parseSha256Sums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(\S+)\s*$/);
    if (!match) continue;
    map.set(match[2], match[1].toLowerCase());
  }
  return map;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function assertSha256Match(
  actual: string,
  expected: string,
  label: string,
): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `checksum mismatch for ${label}: expected ${expected}, got ${actual}`,
    );
  }
}

export function formatUpgradePreview(plan: UpgradePlan): string {
  return [
    `Version: ${plan.version} (${plan.tag})`,
    `Installer: ${plan.installerAsset}`,
    `URL: ${plan.installerUrl}`,
    `SHA256: ${plan.installerDigest}`,
    `Binary: ${plan.binaryAsset}`,
    `Binary SHA256: ${plan.binaryDigest}`,
  ].join('\n');
}

export function upgradeConfirmationState(opts: {
  yes: boolean;
  interactive: boolean;
}): 'proceed' | 'prompt' {
  if (opts.yes) return 'proceed';
  if (!opts.interactive) {
    throw new Error(
      'capa upgrade requires confirmation. Re-run with --yes in non-interactive / CI environments.',
    );
  }
  return 'prompt';
}

function requiredDigest(
  sums: Map<string, string>,
  filename: string,
): string {
  const digest = sums.get(filename);
  if (!digest) {
    throw new Error(`no checksum found for ${filename} in ${CHECKSUMS_ASSET}`);
  }
  return digest;
}

export async function planUpgrade(
  opts: PlanUpgradeOptions,
): Promise<UpgradePlan> {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const latestBody = await opts.fetchText(LATEST_RELEASE_API);
  let tagName: string | undefined;
  try {
    const parsed = JSON.parse(latestBody) as { tag_name?: string };
    tagName = parsed.tag_name;
  } catch {
    throw new Error('GitHub latest-release response was not valid JSON');
  }
  if (!tagName) {
    throw new Error('GitHub latest-release response did not include tag_name');
  }

  const tag = normalizeReleaseTag(tagName);
  const version = tag.replace(/^v/, '');
  const installerAsset = installerAssetFor(platform);
  const binaryAsset = binaryAssetFor(platform, arch);
  const checksumsUrl = githubReleaseAssetUrl(tag, CHECKSUMS_ASSET);
  const installerUrl = githubReleaseAssetUrl(tag, installerAsset);
  const sums = parseSha256Sums(await opts.fetchText(checksumsUrl));

  return {
    tag,
    version,
    installerAsset,
    installerUrl,
    installerDigest: requiredDigest(sums, installerAsset),
    checksumsUrl,
    binaryAsset,
    binaryDigest: requiredDigest(sums, binaryAsset),
  };
}

export async function githubFetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: url.includes('api.github.com')
        ? 'application/vnd.github+json'
        : 'text/plain',
      'User-Agent': 'capa-upgrade',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return await res.text();
}

export async function githubFetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'capa-upgrade',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
