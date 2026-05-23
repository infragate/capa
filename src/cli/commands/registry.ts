import { CapaDatabase } from '../../db/database';
import { loadSettings, getDatabasePath, getManagedRegistriesDir } from '../../shared/config';
import { RegistryManager } from '../../shared/registries/manager';
import {
  installRegistry,
  removeInstalledAdapter,
  deriveSlug,
  isValidSlug,
} from '../../shared/registries/installer';
import { createAuthenticatedFetch } from '../../shared/authenticated-fetch';
import type { RegistrySourceType } from '../../types/database';
import { runTasks, header, footer, success, info, warn, error, type Task } from '../ui';

interface RegistryAddOptions {
  type?: RegistrySourceType;
  noCache?: boolean;
}

function detectType(source: string, explicit?: RegistrySourceType): RegistrySourceType {
  if (explicit) return explicit;
  if (/^https?:\/\//i.test(source)) return 'url';
  return 'github';
}

export async function registryListCommand(): Promise<void> {
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));
  try {
    const records = db.listRegistries();

    if (records.length === 0) {
      console.log('No registries configured.');
      console.log('\nAdd one with:');
      console.log('  capa registry add <source> [slug]');
      return;
    }

    const manager = new RegistryManager(db);
    const manifests = await manager.list();
    const manifestById = new Map<string, { name: string; description?: string }>();
    for (const m of manifests) {
      manifestById.set(m.id, { name: m.name, description: m.description });
    }

    console.log(`Found ${records.length} registry(ies):\n`);
    for (const r of records) {
      const loaded = manifestById.get(r.slug);
      const flag =
        !r.enabled ? 'disabled' :
        r.status === 'installed' ? 'ok' :
        r.status === 'failed' ? 'failed' :
        r.status;
      const display = loaded?.name ?? r.slug;
      console.log(`  ${display} (${r.slug}) [${flag}]`);
      console.log(`    Type:   ${r.type}`);
      console.log(`    Source: ${r.source}`);
      if (r.resolvedRef) console.log(`    Ref:    ${r.resolvedRef.slice(0, 7)}`);
      if (loaded?.description) console.log(`    ${loaded.description}`);
      if (r.lastError) console.log(`    Error:  ${r.lastError}`);
      console.log();
    }

    console.log('Note: Registry adapters are executable TypeScript — only add sources you trust.');
  } finally {
    db.close();
  }
}

export async function registryPathCommand(): Promise<void> {
  console.log(getManagedRegistriesDir());
}

interface AddCtx {
  type: RegistrySourceType;
  source: string;
  slug: string;
  noCache: boolean;
  db: CapaDatabase;
  resolvedRef: string | null;
  manifestName: string;
}

export async function registryAddCommand(
  source: string,
  slugArg: string | undefined,
  options: RegistryAddOptions = {},
): Promise<void> {
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));

  header('Add registry');
  const startedAt = Date.now();
  const type = detectType(source, options.type);
  let slug = slugArg;

  try {
    const tasks: Task<AddCtx>[] = [
      {
        title: 'Validating',
        task: async (ctx, task) => {
          if (!ctx.slug) {
            try {
              ctx.slug = deriveSlug(ctx.source, ctx.type);
            } catch (err: any) {
              throw new Error(`Cannot derive slug from "${ctx.source}": ${err.message}`);
            }
            task.output = `derived slug: ${ctx.slug}`;
          }
          if (!isValidSlug(ctx.slug)) {
            throw new Error(
              `Invalid slug "${ctx.slug}". Allowed: lowercase letters, digits, and dashes; ` +
                `must start with a letter or digit.`,
            );
          }
          const existing = ctx.db.getRegistry(ctx.slug);
          if (existing) {
            throw new Error(
              `Registry "${ctx.slug}" already exists (type=${existing.type}, source=${existing.source}). ` +
                `Use \`capa registry refresh ${ctx.slug}\` to re-fetch, or \`capa registry remove ${ctx.slug}\` first.`,
            );
          }
          task.title = `Validated slug "${ctx.slug}"`;
        },
      },
      {
        title: 'Fetching adapter',
        task: async (ctx, task) => {
          task.output =
            ctx.type === 'url'
              ? `downloading ${ctx.source}`
              : `cloning ${ctx.source} from ${ctx.type}`;
          const authFetch = createAuthenticatedFetch(ctx.db);
          const result = await installRegistry(
            { slug: ctx.slug, type: ctx.type, source: ctx.source },
            authFetch,
            { noCache: ctx.noCache },
          );
          ctx.resolvedRef = result.resolvedRef;
          ctx.manifestName = result.manifest.name;
          task.title = `Fetched "${result.manifest.name}"`;
        },
      },
      {
        title: 'Saving registry',
        task: async (ctx, task) => {
          ctx.db.upsertRegistry({
            slug: ctx.slug,
            type: ctx.type,
            source: ctx.source,
            status: 'installed',
            enabled: true,
            lastError: null,
            resolvedRef: ctx.resolvedRef,
            installedAt: Date.now(),
          });
          task.title = `Saved "${ctx.slug}"`;
        },
      },
    ];

    const ctx: AddCtx = {
      type,
      source,
      slug: slug ?? '',
      noCache: !!options.noCache,
      db,
      resolvedRef: null,
      manifestName: '',
    };

    await runTasks(tasks, { exitOnError: true }, ctx);

    success(`Registry "${ctx.slug}" added.`);
    info(`Use it with: capa add ${ctx.slug}:<item-id>`);
    footer(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exit(1);
  } finally {
    try { db.close(); } catch {}
  }
}

interface RemoveCtx {
  slug: string;
  db: CapaDatabase;
}

export async function registryRemoveCommand(slug: string): Promise<void> {
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));

  try {
    const existing = db.getRegistry(slug);
    if (!existing) {
      error(`Registry "${slug}" not found.`);
      process.exit(1);
    }

    header('Remove registry');
    const tasks: Task<RemoveCtx>[] = [
      {
        title: `Removing "${slug}"`,
        task: async (ctx, task) => {
          task.output = 'deleting record';
          ctx.db.deleteRegistry(ctx.slug);
          task.output = 'cleaning files';
          removeInstalledAdapter(ctx.slug);
          task.title = `Removed "${ctx.slug}"`;
        },
      },
    ];

    await runTasks(tasks, { exitOnError: true }, { slug, db });
    success(`Registry "${slug}" removed.`);
    footer('Done');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exit(1);
  } finally {
    try { db.close(); } catch {}
  }
}

interface RefreshCtx {
  slug: string;
  noCache: boolean;
  db: CapaDatabase;
  resolvedRef: string | null;
  manifestName: string;
}

export async function registryRefreshCommand(
  slug: string,
  options: { noCache?: boolean } = {},
): Promise<void> {
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));

  try {
    const existing = db.getRegistry(slug);
    if (!existing) {
      error(`Registry "${slug}" not found.`);
      process.exit(1);
    }

    header(`Refresh registry "${slug}"`);
    const tasks: Task<RefreshCtx>[] = [
      {
        title: 'Re-fetching adapter',
        task: async (ctx, task) => {
          task.output =
            existing.type === 'url'
              ? `downloading ${existing.source}`
              : `cloning ${existing.source} from ${existing.type}`;
          const authFetch = createAuthenticatedFetch(ctx.db);
          try {
            const result = await installRegistry(
              { slug: ctx.slug, type: existing.type, source: existing.source },
              authFetch,
              { noCache: ctx.noCache },
            );
            ctx.resolvedRef = result.resolvedRef;
            ctx.manifestName = result.manifest.name;
            task.title = `Fetched "${result.manifest.name}"`;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.db.setRegistryStatus(ctx.slug, 'failed', message);
            throw err;
          }
        },
      },
      {
        title: 'Updating record',
        task: async (ctx, task) => {
          ctx.db.upsertRegistry({
            slug: ctx.slug,
            type: existing.type,
            source: existing.source,
            status: 'installed',
            enabled: true,
            lastError: null,
            resolvedRef: ctx.resolvedRef,
            installedAt: Date.now(),
          });
          task.title = `Updated record for "${ctx.slug}"`;
        },
      },
    ];

    await runTasks(tasks, { exitOnError: true }, {
      slug,
      noCache: !!options.noCache,
      db,
      resolvedRef: null,
      manifestName: '',
    });

    success(`Registry "${slug}" refreshed.`);
    footer('Done');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exit(1);
  } finally {
    try { db.close(); } catch {}
  }
}

export async function registrySetEnabledCommand(slug: string, enabled: boolean): Promise<void> {
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));

  try {
    const existing = db.getRegistry(slug);
    if (!existing) {
      error(`Registry "${slug}" not found.`);
      process.exit(1);
    }

    if (existing.enabled === enabled) {
      warn(`Registry "${slug}" is already ${enabled ? 'enabled' : 'disabled'}.`);
      return;
    }

    db.setRegistryEnabled(slug, enabled);
    success(`Registry "${slug}" ${enabled ? 'enabled' : 'disabled'}.`);
  } finally {
    try { db.close(); } catch {}
  }
}
