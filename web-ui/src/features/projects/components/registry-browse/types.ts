import type { RegistryItemSummary } from '../../../registries/api';

export type ResultRow = RegistryItemSummary & {
  registryId: string;
  registryName: string;
  registryIcon?: string;
};

function snippetIdOf(
  installSnippet?: Record<string, unknown> | null,
): string | undefined {
  const id = installSnippet?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Resolve the capa capability id a registry item would install as
 * (matches server-side handleFromRegistry: `installSnippet.id ?? leaf(itemId)`).
 */
export function registryInstallId(
  itemId: string,
  installSnippet?: Record<string, unknown> | null,
): string {
  const fromSnippet = snippetIdOf(installSnippet);
  if (fromSnippet) return fromSnippet;
  const leaf = itemId.split('/').pop();
  return leaf && leaf.length > 0 ? leaf : itemId;
}

/** True when a registry browse row is already present in the project. */
export function isRegistryItemInstalled(
  itemId: string,
  installedIds: ReadonlySet<string>,
  installSnippet?: Record<string, unknown> | null,
): boolean {
  const installId = registryInstallId(itemId, installSnippet);
  if (installedIds.has(installId)) return true;
  // Legacy installs used the leaf path before snippet ids were honored.
  const leaf = itemId.split('/').pop();
  return !!(leaf && leaf !== installId && installedIds.has(leaf));
}
