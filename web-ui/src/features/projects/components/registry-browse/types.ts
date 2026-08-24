import type { RegistryItemSummary } from '../../../registries/api';

export type ResultRow = RegistryItemSummary & {
  registryId: string;
  registryName: string;
  registryIcon?: string;
};

/**
 * Resolve the capa capability id a registry item would install as
 * (matches server-side handleFromRegistry naming).
 */
export function registryInstallId(itemId: string): string {
  const leaf = itemId.split('/').pop();
  return leaf && leaf.length > 0 ? leaf : itemId;
}

/** True when a registry browse row is already present in the project. */
export function isRegistryItemInstalled(
  itemId: string,
  installedIds: ReadonlySet<string>,
): boolean {
  if (installedIds.has(itemId)) return true;
  const leaf = registryInstallId(itemId);
  return leaf !== itemId && installedIds.has(leaf);
}
