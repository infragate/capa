import type { RegistryItemSummary } from '../../../registries/api';

export type ResultRow = RegistryItemSummary & {
  registryId: string;
  registryName: string;
  registryIcon?: string;
};
