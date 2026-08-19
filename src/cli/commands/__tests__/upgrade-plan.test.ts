import { describe, it, expect } from 'bun:test';
import { createHash } from 'crypto';
import {
  assertSha256Match,
  formatUpgradePreview,
  githubReleaseAssetUrl,
  parseSha256Sums,
  planUpgrade,
  upgradeConfirmationState,
} from '../upgrade-plan';

const VENDOR_INSTALL_SH = 'https://capa.infragate.ai/install.sh';
const VENDOR_INSTALL_PS1 = 'https://capa.infragate.ai/install.ps1';

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('capa upgrade planning', () => {
  it('builds a GitHub release asset URL for a pinned version, not the mutable vendor installer URL', () => {
    const url = githubReleaseAssetUrl('v1.2.3', 'install.sh');
    expect(url).toBe(
      'https://github.com/infragate/capa/releases/download/v1.2.3/install.sh',
    );
    expect(url).not.toBe(VENDOR_INSTALL_SH);
    expect(url).not.toContain('capa.infragate.ai');

    const ps1 = githubReleaseAssetUrl('1.2.3', 'install.ps1');
    expect(ps1).toBe(
      'https://github.com/infragate/capa/releases/download/v1.2.3/install.ps1',
    );
    expect(ps1).not.toBe(VENDOR_INSTALL_PS1);
  });

  it('plans an upgrade from GitHub latest + SHA256SUMS and previews version + digest before spawn', async () => {
    const installer = '#!/bin/sh\necho capa-installer\n';
    const installerDigest = sha256Hex(installer);
    const binaryDigest = 'b'.repeat(64);
    const fetched: string[] = [];

    const plan = await planUpgrade({
      platform: 'linux',
      arch: 'x64',
      fetchText: async (url) => {
        fetched.push(url);
        if (url === 'https://api.github.com/repos/infragate/capa/releases/latest') {
          return JSON.stringify({ tag_name: 'v9.9.9' });
        }
        if (
          url ===
          'https://github.com/infragate/capa/releases/download/v9.9.9/SHA256SUMS.txt'
        ) {
          return `${installerDigest}  install.sh\n${binaryDigest}  capa-x86_64-unknown-linux-gnu\n`;
        }
        throw new Error(`unexpected fetch ${url}`);
      },
    });

    expect(fetched.some((u) => u.includes('capa.infragate.ai'))).toBe(false);
    expect(plan.tag).toBe('v9.9.9');
    expect(plan.version).toBe('9.9.9');
    expect(plan.installerAsset).toBe('install.sh');
    expect(plan.installerUrl).toBe(
      'https://github.com/infragate/capa/releases/download/v9.9.9/install.sh',
    );
    expect(plan.installerUrl).not.toBe(VENDOR_INSTALL_SH);
    expect(plan.installerDigest).toBe(installerDigest);
    expect(plan.binaryAsset).toBe('capa-x86_64-unknown-linux-gnu');
    expect(plan.binaryDigest).toBe(binaryDigest);

    const preview = formatUpgradePreview(plan);
    expect(preview).toContain('9.9.9');
    expect(preview).toContain(installerDigest);
    expect(preview).toContain(plan.installerUrl);
  });

  it('refuses when the installer checksum does not match SHA256SUMS', () => {
    const expected = sha256Hex('good-installer');
    expect(() =>
      assertSha256Match(sha256Hex('evil-installer'), expected, 'install.sh'),
    ).toThrow(/checksum mismatch/i);
  });

  it('refuses when SHA256SUMS has no entry for the installer', async () => {
    await expect(
      planUpgrade({
        platform: 'linux',
        arch: 'x64',
        fetchText: async (url) => {
          if (url.includes('/releases/latest')) {
            return JSON.stringify({ tag_name: 'v1.0.0' });
          }
          return `${'c'.repeat(64)}  capa-x86_64-unknown-linux-gnu\n`;
        },
      }),
    ).rejects.toThrow(/no checksum found for install\.sh/i);
  });

  it('--yes skips confirm; no TTY without --yes fails closed', () => {
    expect(upgradeConfirmationState({ yes: true, interactive: false })).toBe(
      'proceed',
    );
    expect(upgradeConfirmationState({ yes: true, interactive: true })).toBe(
      'proceed',
    );
    expect(upgradeConfirmationState({ yes: false, interactive: true })).toBe(
      'prompt',
    );
    expect(() =>
      upgradeConfirmationState({ yes: false, interactive: false }),
    ).toThrow(/--yes/i);
  });

  it('parses GNU SHA256SUMS lines', () => {
    const digest = 'a'.repeat(64);
    const map = parseSha256Sums(`${digest}  install.sh\n`);
    expect(map.get('install.sh')).toBe(digest);
  });
});
