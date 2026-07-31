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

export interface ResolveProvidersOpts {
  flagProvider?: string;
  capabilitiesProviders?: string[];
  /** Previously stored providers. Omit for passthrough (no DB). */
  storedProviders?: string[];
  /**
   * Prompt message when falling through to interactive selection.
   * @default 'Which provider do you want to install for?'
   */
  promptMessage?: string;
  /**
   * Error hint when non-TTY and nothing is configured.
   */
  missingHint?: string;
}

/**
 * Pure provider resolution (no DB writes).
 *
 * Priority:
 *  1. --provider flag (single value, validated)
 *  2. capabilities.providers
 *  3. storedProviders (e.g. from a previous install DB row)
 *  4. Interactive prompt (TTY only; errors in non-TTY)
 */
export async function resolveProviders(opts: ResolveProvidersOpts): Promise<string[]> {
  if (opts.flagProvider) {
    return [validateProvider(opts.flagProvider)];
  }

  if (opts.capabilitiesProviders && opts.capabilitiesProviders.length > 0) {
    return opts.capabilitiesProviders.map((p) => validateProvider(p));
  }

  if (opts.storedProviders && opts.storedProviders.length > 0) {
    return opts.storedProviders;
  }

  const missingHint =
    opts.missingHint ??
    'No provider specified. Pass --provider <id> or add a "providers" section to your capabilities file.\n\n' +
      '  Examples:\n' +
      '    capa install --provider cursor\n' +
      '    capa install -p claude-code';

  if (!process.stdin.isTTY) {
    throw new Error(missingHint);
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
    opts.promptMessage ?? 'Which provider do you want to install for?',
    options,
    '--provider <id>',
  );
  return [selected];
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
  return resolveProviders({
    flagProvider: opts.flagProvider,
    capabilitiesProviders: opts.capabilitiesProviders,
    storedProviders: opts.db.getProjectProviders(opts.projectId),
  });
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
