import type { CapaDatabase } from '../../db/database';
import type { RegistryManager } from './manager';
import type { RegistrySourceType } from '../../types/database';
import type { AuthenticatedFetch } from '../authenticated-fetch';
import { createAuthenticatedFetch } from '../authenticated-fetch';
import { installRegistry } from './installer';

const SEED_META_KEY = 'registries_seeded_v1';

export interface DefaultRegistrySeed {
  slug: string;
  type: RegistrySourceType;
  source: string;
}

// The example adapters that ship in this repo under `registries/<name>/`.
// Each is published as a subdirectory of `infragate/capa`, so we can point
// at them with the same repo-string form a user would type:
//   capa registry add infragate/capa@<name>
export const DEFAULT_REGISTRIES: DefaultRegistrySeed[] = [
  { slug: 'skills-sh', type: 'github', source: 'infragate/capa@skills-sh' },
  { slug: 'claude-plugins', type: 'github', source: 'infragate/capa@claude-plugins' },
  { slug: 'cursor-marketplace', type: 'github', source: 'infragate/capa@cursor-marketplace' },
];

export interface SeedLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  success?: (msg: string) => void;
}

export interface SeedResult {
  attempted: number;
  installed: string[];
  failed: { slug: string; error: string }[];
  skipped: boolean;
}

/**
 * On the very first server start, materialize the bundled example registries
 * so a fresh user immediately sees a populated browse page. Subsequent starts
 * are no-ops thanks to a one-shot flag in the `meta` table.
 *
 * Failures here are non-fatal — each broken seed lands as a `status='failed'`
 * row that the user can fix or remove from the settings page.
 */
export interface SeedOptions {
  authFetch?: AuthenticatedFetch;
  log?: SeedLogger;
  /**
   * Override the seed list (primarily for tests). Defaults to the bundled
   * `DEFAULT_REGISTRIES` shipped with this binary.
   */
  seeds?: DefaultRegistrySeed[];
}

export async function seedDefaultRegistries(
  db: CapaDatabase,
  manager: RegistryManager,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const seeds = options.seeds ?? DEFAULT_REGISTRIES;
  const authFetch = options.authFetch ?? createAuthenticatedFetch(db);
  const log = options.log ?? {};

  const alreadySeeded = db.getMeta(SEED_META_KEY) === '1';
  const hasAnyRegistry = db.listRegistries().length > 0;
  if (alreadySeeded || hasAnyRegistry) {
    return { attempted: 0, installed: [], failed: [], skipped: true };
  }

  log.info?.(`Seeding ${seeds.length} default registries...`);

  const installed: string[] = [];
  const failed: { slug: string; error: string }[] = [];

  for (const seed of seeds) {
    db.upsertRegistry({
      slug: seed.slug,
      type: seed.type,
      source: seed.source,
      status: 'pending',
      enabled: true,
    });

    try {
      const result = await installRegistry(
        { slug: seed.slug, type: seed.type, source: seed.source },
        authFetch,
      );
      db.upsertRegistry({
        slug: seed.slug,
        type: seed.type,
        source: seed.source,
        status: 'installed',
        enabled: true,
        lastError: null,
        resolvedRef: result.resolvedRef,
        installedAt: Date.now(),
      });
      installed.push(seed.slug);
      log.success?.(`Seeded default registry "${seed.slug}"`);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      db.upsertRegistry({
        slug: seed.slug,
        type: seed.type,
        source: seed.source,
        status: 'failed',
        enabled: true,
        lastError: message,
      });
      failed.push({ slug: seed.slug, error: message });
      log.warn?.(`Failed to seed default registry "${seed.slug}": ${message}`);
    }
  }

  // Mark the seed as done regardless of per-registry outcome so we don't keep
  // hammering the network on every restart — users can fix failures by hand.
  db.setMeta(SEED_META_KEY, '1');

  await manager.reload().catch(() => {});

  return {
    attempted: DEFAULT_REGISTRIES.length,
    installed,
    failed,
    skipped: false,
  };
}
