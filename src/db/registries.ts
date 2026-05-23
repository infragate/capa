import type { Database } from 'bun:sqlite';
import type {
  RegistryRecord,
  RegistryRow,
  RegistrySourceType,
  RegistryStatus,
} from '../types/database';

function rowToRecord(row: RegistryRow): RegistryRecord {
  return {
    slug: row.slug,
    type: row.type,
    source: row.source,
    enabled: row.enabled === 1,
    status: row.status,
    lastError: row.last_error,
    resolvedRef: row.resolved_ref,
    installedAt: row.installed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface RegistryUpsertInput {
  slug: string;
  type: RegistrySourceType;
  source: string;
  enabled?: boolean;
  status?: RegistryStatus;
  lastError?: string | null;
  resolvedRef?: string | null;
  installedAt?: number | null;
}

export class RegistriesRepo {
  constructor(private db: Database) {}

  list(): RegistryRecord[] {
    const rows = this.db
      .query('SELECT * FROM registries ORDER BY created_at ASC')
      .all() as RegistryRow[];
    return rows.map(rowToRecord);
  }

  get(slug: string): RegistryRecord | null {
    const row = this.db
      .query('SELECT * FROM registries WHERE slug = ?')
      .get(slug) as RegistryRow | null;
    return row ? rowToRecord(row) : null;
  }

  upsert(input: RegistryUpsertInput): RegistryRecord {
    const now = Date.now();
    const existing = this.get(input.slug);
    const enabled = input.enabled ?? existing?.enabled ?? true;
    const status = input.status ?? existing?.status ?? 'pending';
    const lastError = input.lastError !== undefined ? input.lastError : (existing?.lastError ?? null);
    const resolvedRef = input.resolvedRef !== undefined ? input.resolvedRef : (existing?.resolvedRef ?? null);
    const installedAt = input.installedAt !== undefined ? input.installedAt : (existing?.installedAt ?? null);

    if (existing) {
      this.db.run(
        `UPDATE registries SET
           type = ?,
           source = ?,
           enabled = ?,
           status = ?,
           last_error = ?,
           resolved_ref = ?,
           installed_at = ?,
           updated_at = ?
         WHERE slug = ?`,
        [
          input.type,
          input.source,
          enabled ? 1 : 0,
          status,
          lastError,
          resolvedRef,
          installedAt,
          now,
          input.slug,
        ],
      );
    } else {
      this.db.run(
        `INSERT INTO registries
           (slug, type, source, enabled, status, last_error, resolved_ref, installed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.slug,
          input.type,
          input.source,
          enabled ? 1 : 0,
          status,
          lastError,
          resolvedRef,
          installedAt,
          now,
          now,
        ],
      );
    }

    return this.get(input.slug)!;
  }

  setStatus(slug: string, status: RegistryStatus, lastError: string | null = null): void {
    const now = Date.now();
    this.db.run(
      `UPDATE registries SET status = ?, last_error = ?, updated_at = ? WHERE slug = ?`,
      [status, lastError, now, slug],
    );
  }

  setEnabled(slug: string, enabled: boolean): void {
    const now = Date.now();
    this.db.run(
      `UPDATE registries SET enabled = ?, updated_at = ? WHERE slug = ?`,
      [enabled ? 1 : 0, now, slug],
    );
  }

  delete(slug: string): void {
    this.db.run('DELETE FROM registries WHERE slug = ?', [slug]);
  }
}
