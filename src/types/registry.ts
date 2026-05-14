import type { Skill } from './capabilities';
import type { Plugin } from './plugin';

export type RegistryCapability = 'skills' | 'plugins';

export interface RegistryManifest {
  id: string;
  name: string;
  description?: string;
  homepage?: string;
  icon?: string;
  capabilities: RegistryCapability[];
}

/** Lightweight shape returned by search(). Cheap to produce in bulk. */
export interface RegistryItemSummary {
  id: string;
  capability: RegistryCapability;
  title: string;
  description?: string;
  author?: string;
  version?: string;
  icon?: string;
  tags?: string[];
  homepage?: string;
  updatedAt?: string;
  /**
   * Adapters that can produce a snippet cheaply (e.g. from the search result
   * alone) may include it here so the UI can offer install directly from the
   * listing. Most adapters leave it undefined and let view() supply it.
   */
  installSnippet?: Skill | Plugin;
}

/** Full detail returned by view(). May require additional upstream calls. */
export interface RegistryItemDetail extends RegistryItemSummary {
  /** Markdown body shown in the detail pane (e.g. the SKILL.md content). */
  preview: string;
  /** Required at detail level — pasted into capabilities.yaml on install. */
  installSnippet: Skill | Plugin;
  /** Optional long-form readme separate from the SKILL.md preview. */
  readme?: string;
  /** Optional usage examples (markdown snippets). */
  examples?: string[];
  /** Optional list of files that will be installed with this item. */
  files?: string[];
}

export interface RegistrySearchArgs {
  capability: RegistryCapability;
  query?: string;
  limit?: number;
  cursor?: string;
}

export interface RegistrySearchResult {
  items: RegistryItemSummary[];
  nextCursor?: string;
  total?: number;
}

export interface RegistryViewArgs {
  capability: RegistryCapability;
  id: string;
}

export interface RegistryAdapter {
  manifest: RegistryManifest;

  /** Lightweight search. Should be fast; called on debounced keystrokes. */
  search(args: RegistrySearchArgs): Promise<RegistrySearchResult>;

  /** Full detail fetch. Called when the user clicks/opens an item. */
  view(args: RegistryViewArgs): Promise<RegistryItemDetail>;
}
