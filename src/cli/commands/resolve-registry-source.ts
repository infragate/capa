/**
 * Resolve `registryId:itemId` sources via RegistryManager.
 * Returns null when the source is not a registry form or no adapter matches.
 */

import { RegistryManager } from '../../shared/registries/manager';
import { CapaDatabase } from '../../db/database';
import { loadSettings, getDatabasePath } from '../../shared/config';
import type { RegistryCapability } from '../../types/registry';
import type { Skill } from '../../types/capabilities';
import type { Plugin } from '../../types/plugin';

const RESERVED_PREFIXES = /^(github|gitlab|bitbucket|npm|file|http|https):/i;

export function looksLikeRegistrySource(source: string): boolean {
  if (RESERVED_PREFIXES.test(source)) return false;
  if (source.startsWith('.') || source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source)) {
    return false;
  }
  return /^([a-zA-Z][\w-]*):([\s\S]+)$/.test(source);
}

export interface ResolvedRegistryItem {
  registryId: string;
  registryName: string;
  itemId: string;
  capability: RegistryCapability;
  itemName: string;
  skill?: Skill;
  plugin?: Plugin;
}

/**
 * Try to resolve a `slug:itemId` source against configured registry adapters.
 * Returns null when the source is not registry-shaped or no adapter exists for the slug.
 * Throws when an adapter exists but the item is not found.
 */
export async function tryResolveRegistryItem(source: string): Promise<ResolvedRegistryItem | null> {
  if (!looksLikeRegistrySource(source)) return null;

  const match = source.match(/^([a-zA-Z][\w-]*):([\s\S]+)$/);
  if (!match) return null;
  const [, registryId, itemId] = match;

  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));
  const manager = new RegistryManager(db);
  let adapter;
  let detail: Awaited<ReturnType<typeof manager.view>> | undefined;
  let resolvedCapability: RegistryCapability | undefined;

  try {
    adapter = await manager.getAdapter(registryId);
    if (!adapter) return null;

    for (const cap of adapter.manifest.capabilities) {
      try {
        detail = await manager.view(registryId, { capability: cap, id: itemId });
        resolvedCapability = cap;
        break;
      } catch {
        // try next capability
      }
    }
  } finally {
    try {
      db.close();
    } catch {}
  }

  if (!adapter) return null;

  if (!detail || !resolvedCapability) {
    throw new Error(
      `Item "${itemId}" not found in registry "${registryId}" under any capability ` +
        `(tried: ${adapter.manifest.capabilities.join(', ')}).`,
    );
  }

  const snippet = detail.installSnippet;
  const itemName =
    (typeof (snippet as { id?: unknown }).id === 'string'
      ? (snippet as { id: string }).id
      : null) ??
    itemId.split('/').pop() ??
    'registry-item';

  const result: ResolvedRegistryItem = {
    registryId,
    registryName: adapter.manifest.name,
    itemId,
    capability: resolvedCapability,
    itemName,
  };

  if (resolvedCapability === 'skills') {
    result.skill = { ...(snippet as Skill), id: itemName };
  } else if (resolvedCapability === 'plugins') {
    result.plugin = { ...(snippet as Plugin), id: itemName };
  }

  return result;
}
