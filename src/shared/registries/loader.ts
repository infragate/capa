import { statSync } from 'fs';
import { logger } from '../logger';
import type { CapaDatabase } from '../../db/database';
import type { RegistryAdapter } from '../../types/registry';
import { getInstalledAdapterPath } from './installer';

interface LoadedRegistry {
  adapter: RegistryAdapter;
  slug: string;
  mtime: number;
  updatedAt: number;
}

export interface RegistryLoadFailure {
  slug: string;
  error: string;
}

export interface RegistryLoadResult {
  adapters: Map<string, RegistryAdapter>;
  failures?: RegistryLoadFailure[];
}

const registryLogger = logger.child('Registries');

function isValidAdapter(obj: unknown): obj is RegistryAdapter {
  if (!obj || typeof obj !== 'object') return false;
  const a = obj as Record<string, unknown>;
  if (!a.manifest || typeof a.manifest !== 'object') return false;
  const m = a.manifest as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    typeof m.name === 'string' &&
    m.name.length > 0 &&
    Array.isArray(m.capabilities) &&
    m.capabilities.length > 0 &&
    typeof a.search === 'function' &&
    typeof a.view === 'function'
  );
}

/**
 * Loads registry adapters whose DB row is `enabled = true` and
 * `status = 'installed'`, dynamic-importing each materialized adapter file
 * once and caching by mtime + DB updated_at. NOTE: Node/Bun's ESM loader
 * caches modules by URL, so we add a `?t=<mtime>` cache-buster to pick up
 * file changes; old module instances stay in the loader's internal cache
 * for the lifetime of the process.
 */
export class RegistryLoader {
  private cache = new Map<string, LoadedRegistry>();

  constructor(private db: CapaDatabase) {}

  async loadAll(): Promise<RegistryLoadResult> {
    const records = this.db.listRegistries().filter((r) => r.enabled && r.status === 'installed');

    const adapters = new Map<string, RegistryAdapter>();
    const failures: RegistryLoadFailure[] = [];
    const seenIds = new Set<string>();
    const activeSlugs = new Set<string>();

    for (const record of records) {
      activeSlugs.add(record.slug);
      const adapterPath = getInstalledAdapterPath(record.slug);
      if (!adapterPath) {
        failures.push({
          slug: record.slug,
          error: `No materialized adapter file for slug "${record.slug}"; run \`capa registry refresh ${record.slug}\`.`,
        });
        continue;
      }

      let mtime: number;
      try {
        mtime = statSync(adapterPath).mtimeMs;
      } catch (err: any) {
        failures.push({
          slug: record.slug,
          error: `Cannot stat ${adapterPath}: ${err?.message ?? err}`,
        });
        continue;
      }

      const cached = this.cache.get(record.slug);
      if (cached && cached.mtime === mtime && cached.updatedAt === record.updatedAt) {
        const id = cached.adapter.manifest.id;
        if (seenIds.has(id)) {
          registryLogger.warn(`Duplicate registry id "${id}" from slug "${record.slug}", skipping`);
          continue;
        }
        seenIds.add(id);
        adapters.set(id, cached.adapter);
        continue;
      }

      try {
        const moduleUrl = `file://${adapterPath.replace(/\\/g, '/')}?t=${mtime}`;
        const module = await import(moduleUrl);
        const adapter: unknown = module.default ?? module;

        if (!isValidAdapter(adapter)) {
          const msg =
            `Adapter for slug "${record.slug}" does not export a valid RegistryAdapter ` +
            `(needs default export with { manifest, search, view }).`;
          registryLogger.warn(msg);
          failures.push({ slug: record.slug, error: msg });
          continue;
        }

        const id = adapter.manifest.id;
        if (seenIds.has(id)) {
          const msg = `Duplicate registry id "${id}" from slug "${record.slug}"; skipping.`;
          registryLogger.warn(msg);
          failures.push({ slug: record.slug, error: msg });
          continue;
        }

        seenIds.add(id);
        this.cache.set(record.slug, {
          adapter,
          slug: record.slug,
          mtime,
          updatedAt: record.updatedAt,
        });
        adapters.set(id, adapter);
        registryLogger.info(`Loaded registry "${id}" from slug "${record.slug}"`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        registryLogger.warn(`Failed to load registry adapter for slug "${record.slug}": ${message}`);
        failures.push({ slug: record.slug, error: message });
      }
    }

    for (const slug of [...this.cache.keys()]) {
      if (!activeSlugs.has(slug)) {
        this.cache.delete(slug);
      }
    }

    return failures.length > 0 ? { adapters, failures } : { adapters };
  }
}
