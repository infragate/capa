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
import type { RegistryCapability, RegistryItemSummary } from '../../types/registry';
import { runTasks, header, footer, success, info, warn, error, isJson, isVerbose, c, type Task } from '../ui';

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

const CAPABILITY_LABEL: Record<RegistryCapability, string> = {
  skills: 'skill',
  plugins: 'plugin',
};

export interface RegistrySearchOptions {
  slug?: string;
  capability?: RegistryCapability;
  limit?: number;
}

interface SearchHit {
  source: string;
  type: string;
  item: RegistryItemSummary;
}

export async function registrySearchCommand(
  query: string,
  options: RegistrySearchOptions = {},
): Promise<void> {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) {
    error('A search query is required.');
    process.exit(1);
  }

  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));

  try {
    const records = db.listRegistries().filter((r) => r.enabled && r.status === 'installed');

    let targets = records;
    if (options.slug) {
      const match = records.find((r) => r.slug === options.slug);
      if (!match) {
        const existing = db.getRegistry(options.slug);
        if (!existing) {
          error(`Registry "${options.slug}" not found.`);
        } else if (!existing.enabled) {
          error(`Registry "${options.slug}" is disabled. Enable it with: capa registry enable ${options.slug}`);
        } else {
          error(`Registry "${options.slug}" is not installed (status: ${existing.status}). Try: capa registry refresh ${options.slug}`);
        }
        process.exit(1);
      }
      targets = [match];
    }

    if (targets.length === 0) {
      if (isJson()) {
        process.stdout.write(JSON.stringify({ query: trimmedQuery, results: [], total: 0 }) + '\n');
        return;
      }
      info('No enabled registries to search. Add one with: capa registry add <source>');
      return;
    }

    const manager = new RegistryManager(db);
    const manifests = await manager.list();
    const manifestBySlug = new Map(manifests.map((m) => [m.id, m]));

    const hits: SearchHit[] = [];
    const failures: { slug: string; capability: RegistryCapability; error: string }[] = [];

    const calls: Promise<void>[] = [];
    for (const r of targets) {
      const manifest = manifestBySlug.get(r.slug);
      if (!manifest) {
        failures.push({ slug: r.slug, capability: 'skills', error: 'adapter not loaded' });
        continue;
      }
      const capsToSearch: RegistryCapability[] = options.capability
        ? manifest.capabilities.includes(options.capability) ? [options.capability] : []
        : manifest.capabilities;

      for (const capability of capsToSearch) {
        calls.push(
          manager
            .search(r.slug, { capability, query: trimmedQuery, limit: options.limit })
            .then((result) => {
              for (const item of result.items) {
                hits.push({ source: r.slug, type: CAPABILITY_LABEL[capability], item });
              }
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              failures.push({ slug: r.slug, capability, error: message });
            }),
        );
      }
    }

    await Promise.all(calls);

    if (isJson()) {
      const payload = {
        query: trimmedQuery,
        results: hits.map((h) => ({
          id: h.item.id,
          title: h.item.title,
          description: h.item.description,
          source: h.source,
          type: h.type,
          capability: h.item.capability,
          author: h.item.author,
          version: h.item.version,
          tags: h.item.tags,
          homepage: h.item.homepage,
          updatedAt: h.item.updatedAt,
        })),
        total: hits.length,
        failures: failures.length > 0 ? failures : undefined,
      };
      process.stdout.write(JSON.stringify(payload) + '\n');
      return;
    }

    if (failures.length > 0) {
      for (const f of failures) {
        warn(`Registry "${f.slug}" (${f.capability}): ${f.error}`);
      }
    }

    if (hits.length === 0) {
      info(`No results for "${trimmedQuery}".`);
      return;
    }

    if (isVerbose()) {
      printVerboseResults(hits);
    } else {
      printSearchTable(hits);
    }
    info(`${hits.length} result${hits.length === 1 ? '' : 's'} for "${trimmedQuery}".`);
  } finally {
    try { db.close(); } catch {}
  }
}

function printSearchTable(hits: SearchHit[]): void {
  const rows: [string, string, string, string][] = hits.map((h) => [
    h.item.id,
    h.source,
    h.type,
    truncate(h.item.description ?? '', 60),
  ]);
  const headers: [string, string, string, string] = ['Name', 'Source', 'Type', 'Description'];
  const widths = [0, 1, 2, 3].map((i) =>
    Math.max(headers[i].length, ...rows.map((r) => r[i].length)),
  );

  const fmt = (cells: readonly string[]) =>
    cells.map((cell, i) => i === cells.length - 1 ? cell : cell.padEnd(widths[i])).join('  ');

  console.log(c.bold(fmt(headers)));
  console.log(c.dim(widths.map((w) => '-'.repeat(w)).join('  ')));
  for (const r of rows) console.log(fmt(r));
}

function printVerboseResults(hits: SearchHit[]): void {
  for (const h of hits) {
    console.log(c.bold(h.item.id) + c.dim(`  (${h.source} · ${h.type})`));
    if (h.item.title && h.item.title !== h.item.id) console.log(`  ${h.item.title}`);
    if (h.item.description) console.log(`  ${h.item.description}`);
    const extras: string[] = [];
    if (h.item.author) extras.push(`author: ${h.item.author}`);
    if (h.item.version) extras.push(`version: ${h.item.version}`);
    if (h.item.updatedAt) extras.push(`updated: ${h.item.updatedAt}`);
    if (h.item.homepage) extras.push(h.item.homepage);
    if (extras.length) console.log(c.dim('  ' + extras.join(' · ')));
    if (h.item.tags && h.item.tags.length) console.log(c.dim(`  tags: ${h.item.tags.join(', ')}`));
    console.log();
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}
