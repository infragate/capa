import type { CapaDatabase } from '../db/database';
import type { RegistryManager } from '../shared/registries/manager';
import {
  installRegistry,
  removeInstalledAdapter,
  fetchAdapterSource,
  isValidSlug,
  deriveSlug,
} from '../shared/registries/installer';
import { createAuthenticatedFetch } from '../shared/authenticated-fetch';
import type { RegistrySourceType } from '../types/database';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function parseTypeQuery(value: string | null): RegistrySourceType | null {
  if (value === 'github' || value === 'gitlab' || value === 'url') return value;
  return null;
}

export async function listRegistriesHandler(
  db: CapaDatabase,
  manager: RegistryManager,
): Promise<Response> {
  const records = db.listRegistries();
  let manifests;
  try {
    manifests = await manager.list();
  } catch {
    manifests = [];
  }
  const manifestById = new Map(manifests.map((m) => [m.id, m]));
  const enriched = records.map((r) => ({
    ...r,
    manifest: manifestById.get(r.slug) ?? null,
  }));
  return jsonOk({ registries: enriched });
}

export async function createRegistryHandler(
  db: CapaDatabase,
  manager: RegistryManager,
  request: Request,
): Promise<Response> {
  let body: { slug?: string; type?: string; source?: string };
  try {
    body = (await request.json()) as { slug?: string; type?: string; source?: string };
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const type = parseTypeQuery(body.type ?? null);
  if (!type) {
    return jsonError('Field "type" must be one of: github, gitlab, url.', 400);
  }
  const source = body.source;
  if (!source || typeof source !== 'string') {
    return jsonError('Field "source" is required.', 400);
  }

  let slug: string;
  try {
    slug = body.slug ?? deriveSlug(source, type);
  } catch (err: any) {
    return jsonError(`Cannot derive slug: ${err?.message ?? err}`, 400);
  }
  if (!isValidSlug(slug)) {
    return jsonError(
      `Invalid slug "${slug}". Allowed: lowercase letters, digits, and dashes; must start with a letter or digit.`,
      400,
    );
  }
  if (db.getRegistry(slug)) {
    return jsonError(`Registry "${slug}" already exists.`, 409);
  }

  try {
    const authFetch = createAuthenticatedFetch(db);
    const result = await installRegistry({ slug, type, source }, authFetch);
    const record = db.upsertRegistry({
      slug,
      type,
      source,
      status: 'installed',
      enabled: true,
      lastError: null,
      resolvedRef: result.resolvedRef,
      installedAt: Date.now(),
    });
    await manager.reload().catch(() => {});
    return jsonOk({ registry: record, manifest: result.manifest }, 201);
  } catch (err: any) {
    return jsonError(err?.message ?? String(err), 400);
  }
}

export async function deleteRegistryHandler(
  db: CapaDatabase,
  manager: RegistryManager,
  slug: string,
): Promise<Response> {
  if (!db.getRegistry(slug)) {
    return jsonError(`Registry "${slug}" not found.`, 404);
  }
  db.deleteRegistry(slug);
  removeInstalledAdapter(slug);
  await manager.reload().catch(() => {});
  return new Response(null, { status: 204 });
}

export async function patchRegistryHandler(
  db: CapaDatabase,
  manager: RegistryManager,
  slug: string,
  request: Request,
): Promise<Response> {
  const existing = db.getRegistry(slug);
  if (!existing) {
    return jsonError(`Registry "${slug}" not found.`, 404);
  }
  let body: { enabled?: boolean; type?: string; source?: string };
  try {
    body = (await request.json()) as {
      enabled?: boolean;
      type?: string;
      source?: string;
    };
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const hasEnabled = typeof body.enabled === 'boolean';
  const hasType = typeof body.type === 'string';
  const hasSource = typeof body.source === 'string';

  if (!hasEnabled && !hasType && !hasSource) {
    return jsonError(
      'Provide at least one of: "enabled" (boolean), "type", "source".',
      400,
    );
  }

  // Source / type changes require re-running the installer so the
  // materialized adapter matches the new upstream pointer.
  const newType = hasType ? parseTypeQuery(body.type!) : existing.type;
  if (hasType && !newType) {
    return jsonError('Field "type" must be one of: github, gitlab, url.', 400);
  }
  const newSource = hasSource ? body.source!.trim() : existing.source;
  if (hasSource && !newSource) {
    return jsonError('Field "source" cannot be empty.', 400);
  }

  const typeChanged = hasType && newType !== existing.type;
  const sourceChanged = hasSource && newSource !== existing.source;
  const needsReinstall = typeChanged || sourceChanged;

  if (needsReinstall) {
    try {
      const authFetch = createAuthenticatedFetch(db);
      const result = await installRegistry(
        { slug, type: newType!, source: newSource },
        authFetch,
      );
      const record = db.upsertRegistry({
        slug,
        type: newType!,
        source: newSource,
        status: 'installed',
        enabled: hasEnabled ? body.enabled! : existing.enabled,
        lastError: null,
        resolvedRef: result.resolvedRef,
        installedAt: Date.now(),
      });
      await manager.reload().catch(() => {});
      return jsonOk({ registry: record, manifest: result.manifest });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      // Persist the new pointer so the user can fix and retry, but mark
      // the row failed so the loader stops serving the broken adapter.
      db.upsertRegistry({
        slug,
        type: newType!,
        source: newSource,
        status: 'failed',
        enabled: hasEnabled ? body.enabled! : existing.enabled,
        lastError: message,
        resolvedRef: existing.resolvedRef,
        installedAt: existing.installedAt,
      });
      await manager.reload().catch(() => {});
      return jsonError(message, 400);
    }
  }

  if (hasEnabled) {
    db.setRegistryEnabled(slug, body.enabled!);
    await manager.reload().catch(() => {});
  }
  return jsonOk({ registry: db.getRegistry(slug) });
}

export async function refreshRegistryHandler(
  db: CapaDatabase,
  manager: RegistryManager,
  slug: string,
): Promise<Response> {
  const existing = db.getRegistry(slug);
  if (!existing) {
    return jsonError(`Registry "${slug}" not found.`, 404);
  }
  try {
    const authFetch = createAuthenticatedFetch(db);
    const result = await installRegistry(
      { slug: existing.slug, type: existing.type, source: existing.source },
      authFetch,
    );
    const record = db.upsertRegistry({
      slug: existing.slug,
      type: existing.type,
      source: existing.source,
      status: 'installed',
      enabled: true,
      lastError: null,
      resolvedRef: result.resolvedRef,
      installedAt: Date.now(),
    });
    await manager.reload().catch(() => {});
    return jsonOk({ registry: record, manifest: result.manifest });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    db.setRegistryStatus(slug, 'failed', message);
    return new Response(JSON.stringify({ error: message, slug }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
}

export async function previewRegistryHandler(
  db: CapaDatabase,
  url: URL,
): Promise<Response> {
  const type = parseTypeQuery(url.searchParams.get('type'));
  const source = url.searchParams.get('source');
  if (!type) {
    return jsonError('Query "type" must be one of: github, gitlab, url.', 400);
  }
  if (!source) {
    return jsonError('Query "source" is required.', 400);
  }
  try {
    const authFetch = createAuthenticatedFetch(db);
    const { content, resolvedRef } = await fetchAdapterSource({ type, source }, authFetch);
    let derivedSlug: string | null = null;
    try {
      const candidate = deriveSlug(source, type);
      derivedSlug = isValidSlug(candidate) ? candidate : null;
    } catch {
      derivedSlug = null;
    }
    return jsonOk({ content, resolvedRef, derivedSlug });
  } catch (err: any) {
    return jsonError(err?.message ?? String(err), 400);
  }
}
