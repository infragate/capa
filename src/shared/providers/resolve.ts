import { getProvider, getAllProviders } from './index';
import { logger } from '../logger';
import { prompt, type SelectOption } from '../../cli/ui';
import type { CapaDatabase } from '../../db/database';

/**
 * Validate that a provider id exists in the registry.
 * Returns the canonical (lowercase) provider id.
 * Throws with a formatted list of valid providers when invalid.
 */
export function validateProvider(id: string): string {
  const provider = getProvider(id);
  if (provider) return provider.id;

  const supportedAgents = getAllProviders()
    .map((p) => ({ name: p.id, displayName: p.displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const maxLen = Math.max(...supportedAgents.map((a) => a.displayName.length));
  const lines = supportedAgents.map(
    (a) => `    - ${a.displayName.padEnd(maxLen)} (${a.name})`
  );

  throw new Error(
    `Unknown provider: ${id}\n\n  Supported providers:\n${lines.join('\n')}`
  );
}

export interface ResolveInstallOpts {
  flagProvider?: string;
  capabilitiesProviders?: string[];
  db: CapaDatabase;
  projectId: string;
}

/**
 * Resolve the provider list for `capa install`.
 *
 * Priority:
 *  1. --provider flag (single value, validated)
 *  2. capabilities.providers (from the YAML/JSON file)
 *  3. Stored in DB from a previous install
 *  4. Interactive prompt (TTY only; errors in non-TTY)
 */
export async function resolveProvidersForInstall(
  opts: ResolveInstallOpts
): Promise<string[]> {
  // 1. CLI flag
  if (opts.flagProvider) {
    return [validateProvider(opts.flagProvider)];
  }

  // 2. Capabilities file
  if (opts.capabilitiesProviders && opts.capabilitiesProviders.length > 0) {
    return opts.capabilitiesProviders.map((p) => validateProvider(p));
  }

  // 3. Database (previous install)
  const stored = opts.db.getProjectProviders(opts.projectId);
  if (stored.length > 0) {
    return stored;
  }

  // 4. Interactive prompt
  if (!process.stdin.isTTY) {
    throw new Error(
      'No provider specified. Pass --provider <id> or add a "providers" section to your capabilities file.\n\n' +
        '  Examples:\n' +
        '    capa install --provider cursor\n' +
        '    capa install -p claude-code'
    );
  }

  const detected = await detectInstalledProviders();
  const options: SelectOption[] =
    detected.length > 0
      ? detected
      : getAllProviders()
          .filter((p) => p.showInUniversalList !== false)
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map((p) => ({ value: p.id, label: p.displayName }));

  logger.info('');
  logger.info('No provider detected in capabilities file.');
  const selected = await prompt.select(
    'Which provider do you want to install for?',
    options,
    '--provider <id>',
  );
  return [selected];
}

export interface ResolveCleanOpts {
  capabilitiesProviders?: string[];
  db: CapaDatabase;
  projectId: string;
}

/**
 * Resolve the provider list for `capa clean`.
 * No interactive prompt — returns empty when nothing is configured.
 */
export function resolveProvidersForClean(opts: ResolveCleanOpts): string[] {
  if (opts.capabilitiesProviders && opts.capabilitiesProviders.length > 0) {
    return opts.capabilitiesProviders;
  }

  const stored = opts.db.getProjectProviders(opts.projectId);
  if (stored.length > 0) {
    return stored;
  }

  return [];
}

async function detectInstalledProviders(): Promise<SelectOption[]> {
  const all = getAllProviders().filter(
    (p) => p.detectInstalled && p.showInUniversalList !== false
  );
  const results: SelectOption[] = [];

  for (const p of all) {
    try {
      if (await p.detectInstalled!()) {
        results.push({ value: p.id, label: p.displayName });
      }
    } catch {
      // ignore detection failures
    }
  }

  return results.sort((a, b) => a.label.localeCompare(b.label));
}
