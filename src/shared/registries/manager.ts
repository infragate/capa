import { RegistryLoader } from './loader';
import type {
  RegistryAdapter,
  RegistryManifest,
  RegistrySearchArgs,
  RegistrySearchResult,
  RegistryViewArgs,
  RegistryItemDetail,
} from '../../types/registry';

const MAX_ITEMS_PER_PAGE = 200;
const CALL_TIMEOUT_MS = 15_000;
const LOAD_TTL_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * High-level manager wrapping RegistryLoader. Exposes list / search / view
 * with per-call timeouts and result-size clamping.
 */
export class RegistryManager {
  private loader = new RegistryLoader();
  private adapters = new Map<string, RegistryAdapter>();
  private lastLoadedAt = 0;

  /** Force a rescan of the registries directory. */
  async reload(): Promise<void> {
    this.adapters = await this.loader.loadAll();
    this.lastLoadedAt = Date.now();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.adapters.size === 0 || Date.now() - this.lastLoadedAt > LOAD_TTL_MS) {
      await this.reload();
    }
  }

  async list(): Promise<RegistryManifest[]> {
    await this.ensureLoaded();
    return Array.from(this.adapters.values()).map((a) => ({ ...a.manifest }));
  }

  async getAdapter(id: string): Promise<RegistryAdapter | undefined> {
    await this.ensureLoaded();
    return this.adapters.get(id);
  }

  async search(registryId: string, args: RegistrySearchArgs): Promise<RegistrySearchResult> {
    await this.ensureLoaded();
    const adapter = this.adapters.get(registryId);
    if (!adapter) throw new Error(`Registry "${registryId}" not found`);

    const clampedArgs: RegistrySearchArgs = {
      ...args,
      limit: Math.min(args.limit ?? 20, MAX_ITEMS_PER_PAGE),
    };

    const result = await withTimeout(
      adapter.search(clampedArgs),
      CALL_TIMEOUT_MS,
      `${registryId}.search`,
    );

    if (result.items.length > MAX_ITEMS_PER_PAGE) {
      result.items = result.items.slice(0, MAX_ITEMS_PER_PAGE);
    }

    return result;
  }

  async view(registryId: string, args: RegistryViewArgs): Promise<RegistryItemDetail> {
    await this.ensureLoaded();
    const adapter = this.adapters.get(registryId);
    if (!adapter) throw new Error(`Registry "${registryId}" not found`);

    return withTimeout(
      adapter.view(args),
      CALL_TIMEOUT_MS,
      `${registryId}.view`,
    );
  }
}
