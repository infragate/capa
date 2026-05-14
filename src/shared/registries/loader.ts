import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getRegistriesDir } from '../config';
import { logger } from '../logger';
import type { RegistryAdapter, RegistryManifest } from '../../types/registry';

interface LoadedRegistry {
  adapter: RegistryAdapter;
  filePath: string;
  mtime: number;
}

const VALID_EXTENSIONS = new Set(['.ts', '.js', '.mjs']);

const registryLogger = logger.child('Registries');

function isValidManifest(manifest: unknown): manifest is RegistryManifest {
  if (!manifest || typeof manifest !== 'object') return false;
  const m = manifest as Record<string, unknown>;
  return (
    typeof m.id === 'string' && m.id.length > 0 &&
    typeof m.name === 'string' && m.name.length > 0 &&
    Array.isArray(m.capabilities) && m.capabilities.length > 0 &&
    m.capabilities.every((c: unknown) => typeof c === 'string')
  );
}

function isValidAdapter(obj: unknown): obj is RegistryAdapter {
  if (!obj || typeof obj !== 'object') return false;
  const a = obj as Record<string, unknown>;
  return (
    isValidManifest(a.manifest) &&
    typeof a.search === 'function' &&
    typeof a.view === 'function'
  );
}

/**
 * Scans ~/.capa/registries/ for .ts/.js/.mjs files and dynamic-imports each
 * one. Validates that the default export conforms to RegistryAdapter.
 * Caches by file mtime so repeated calls are cheap.
 *
 * NOTE: Node/Bun's ESM loader caches modules by URL. We use a `?t=<mtime>`
 * cache-buster to pick up file changes, but old module instances remain in the
 * loader's internal cache for the lifetime of the process. For long-running
 * servers where adapters are edited frequently, restart the server to reclaim
 * memory.
 */
export class RegistryLoader {
  private cache = new Map<string, LoadedRegistry>();

  async loadAll(): Promise<Map<string, RegistryAdapter>> {
    const dir = getRegistriesDir();
    const result = new Map<string, RegistryAdapter>();

    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      return result;
    }

    const seen = new Set<string>();

    for (const file of files) {
      const ext = file.slice(file.lastIndexOf('.'));
      if (!VALID_EXTENSIONS.has(ext)) continue;

      const filePath = join(dir, file);
      let mtime: number;
      try {
        mtime = statSync(filePath).mtimeMs;
      } catch {
        continue;
      }

      const cached = this.cache.get(filePath);
      if (cached && cached.mtime === mtime) {
        const id = cached.adapter.manifest.id;
        if (seen.has(id)) {
          registryLogger.warn(`Duplicate registry id "${id}" in ${file}, skipping`);
          continue;
        }
        seen.add(id);
        result.set(id, cached.adapter);
        continue;
      }

      try {
        const cacheBuster = `?t=${mtime}`;
        const moduleUrl = `file://${filePath.replace(/\\/g, '/')}${cacheBuster}`;
        const module = await import(moduleUrl);
        const adapter: unknown = module.default ?? module;

        if (!isValidAdapter(adapter)) {
          registryLogger.warn(
            `${file}: default export does not conform to RegistryAdapter (needs manifest, search, view). Skipping.`
          );
          continue;
        }

        const id = adapter.manifest.id;
        if (seen.has(id)) {
          registryLogger.warn(`Duplicate registry id "${id}" in ${file}, skipping`);
          continue;
        }

        seen.add(id);
        this.cache.set(filePath, { adapter, filePath, mtime });
        result.set(id, adapter);
        registryLogger.info(`Loaded registry "${id}" from ${file}`);
      } catch (err: any) {
        registryLogger.warn(`Failed to load ${file}: ${err.message}`);
      }
    }

    // Evict stale cache entries for files that no longer exist
    for (const [path] of this.cache) {
      const fileName = path.split(/[/\\]/).pop()!;
      if (!files.includes(fileName)) {
        this.cache.delete(path);
      }
    }

    return result;
  }
}
