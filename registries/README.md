# Registry Adapters

Registry adapters let capa connect to third-party skill and plugin registries — whether public (like [skills.sh](https://skills.sh)) or private (an internal company registry behind a VPN).

Each adapter is a single `.ts` (or `.js` / `.mjs`) file that ships inside a folder containing an `adapter.{ts,js,mjs}` entry point. Capa fetches the file from GitHub, GitLab, or an HTTPS URL, validates its shape, and stores a row in its database — there is no longer a "drop a file in `~/.capa/registries/`" path.

## Quick start

Add a registry with `capa registry add`:

```bash
# Add the example skills-sh adapter from this repo (search-form)
capa registry add infragate/capa@skills-sh

# Same, with an explicit slug
capa registry add infragate/capa@skills-sh skills-sh

# A GitLab source with an exact path
capa registry add my-org/internal-tools::registries/internal --type=gitlab

# A direct HTTPS URL to an adapter file (HTTPS is required)
capa registry add https://example.com/adapters/my-registry.ts
```

The adapter file is fetched, validated by dynamic-importing it, and copied into `~/.capa/registries-managed/<slug>/adapter.{ts,js,mjs}`. Open the web UI — the **Registries** nav link is always visible, and the **Manage registries** button (or `/ui/registries/settings`) lets you add, refresh, enable/disable, and remove registries with a "Preview" of the adapter source before installing.

The reference adapters in this folder are kept as starting points — once you've added one with `capa registry add`, capa owns the on-disk copy.

## How it works

```
~/.capa/registries-managed/
├── skills-sh/
│   └── adapter.ts
├── cursor-marketplace/
│   └── adapter.ts
└── my-company/
    └── adapter.ts
```

Capa tracks each registry in a `registries` table (slug, type, source, enabled, status, last_error, resolved_ref). On every server start, and at most every 30 seconds while running, the loader reads `enabled = true AND status = 'installed'` rows from the database and dynamic-imports each materialized `adapter.{ts,js,mjs}`. The server then exposes the adapters through its API, and the web UI renders a tab for each one.

Adapter files are **self-contained** — they run in the server process and can use `fetch` to call any upstream API. There is no compilation step; Bun transpiles TypeScript on the fly.

## Managing registries

```bash
capa registry list                  # show all rows (installed / failed / disabled), source, resolved ref
capa registry refresh <slug>        # re-fetch the adapter from its stored source
capa registry remove <slug>         # delete the row and its managed file
capa registry enable <slug>         # bring a disabled registry back
capa registry disable <slug>        # hide a registry without removing it
capa registry path                  # print ~/.capa/registries-managed/
```

Most of those actions also exist in the web UI at `/ui/registries/settings`. The Add dialog includes a **Preview** button that calls `GET /api/registries/preview` and renders the raw adapter source in the dialog so you can audit it before checking *"I trust this code"* and confirming the install.

## The `RegistryAdapter` interface

An adapter is an object with three parts: a **manifest**, a **search** function, and a **view** function.

```ts
interface RegistryAdapter {
  manifest: RegistryManifest;
  search(args: RegistrySearchArgs): Promise<RegistrySearchResult>;
  view(args: RegistryViewArgs): Promise<RegistryItemDetail>;
}
```

### Manifest

Declares metadata about the registry and which capabilities it supports.

```ts
interface RegistryManifest {
  id: string;              // Unique identifier (e.g. "skills-sh")
  name: string;            // Display name (e.g. "Skills.sh")
  description?: string;    // Short description
  homepage?: string;       // URL to the registry website
  icon?: string;           // URL to a favicon / logo
  capabilities: RegistryCapability[];  // ["skills"], ["plugins"], or both
}

type RegistryCapability = 'skills' | 'plugins';
```

The `capabilities` array determines which tabs appear in the UI for this registry. If your registry only serves plugins, set `capabilities: ['plugins']` — the Skills tab won't show.

### `search(args)`

Called on every (debounced) keystroke in the search bar. Should be lightweight and fast.

```ts
interface RegistrySearchArgs {
  capability: RegistryCapability;  // Which tab the user is on
  query?: string;                  // The search text (may be empty)
  limit?: number;                  // Max results to return
}
```

Returns a list of lightweight summaries:

```ts
interface RegistrySearchResult {
  items: RegistryItemSummary[];
  total?: number;  // Total matches (for "showing X of Y")
}

interface RegistryItemSummary {
  id: string;                       // Unique item ID within this registry
  capability: RegistryCapability;
  title: string;
  description?: string;
  author?: string;
  version?: string;
  icon?: string;                    // URL to an item icon
  tags?: string[];
  homepage?: string;
}
```

### `view(args)`

Called when the user clicks an item. May make additional upstream calls (e.g. fetching a SKILL.md file).

```ts
interface RegistryViewArgs {
  capability: RegistryCapability;
  id: string;  // The item's id from the search result
}
```

Returns full details including a markdown preview and an install snippet:

```ts
interface RegistryItemDetail extends RegistryItemSummary {
  preview: string;                          // Markdown body (e.g. SKILL.md content)
  installSnippet: Record<string, unknown>;  // Pasted into capabilities.yaml
  files?: string[];                         // Files that will be installed
}
```

The `installSnippet` is what gets added to the user's `capabilities.yaml` when they install the item. For skills it typically looks like:

```ts
installSnippet: {
  id: 'my-skill',
  type: 'github',
  def: { repo: 'owner/repo@skill-name' }
}
```

For plugins:

```ts
installSnippet: {
  type: 'remote',
  def: { uri: 'github:owner/repo' }
}
```

## Writing your own adapter

Here's a minimal adapter template:

```ts
type RegistryCapability = 'skills' | 'plugins';

interface RegistryManifest {
  id: string;
  name: string;
  description?: string;
  homepage?: string;
  icon?: string;
  capabilities: RegistryCapability[];
}

interface RegistryItemSummary {
  id: string;
  capability: RegistryCapability;
  title: string;
  description?: string;
  author?: string;
  version?: string;
  icon?: string;
  tags?: string[];
  homepage?: string;
}

interface RegistryItemDetail extends RegistryItemSummary {
  preview: string;
  installSnippet: Record<string, unknown>;
  files?: string[];
}

interface RegistryAdapter {
  manifest: RegistryManifest;
  search(args: { capability: RegistryCapability; query?: string; limit?: number }): Promise<{ items: RegistryItemSummary[]; total?: number }>;
  view(args: { capability: RegistryCapability; id: string }): Promise<RegistryItemDetail>;
}

const adapter: RegistryAdapter = {
  manifest: {
    id: 'my-registry',
    name: 'My Registry',
    description: 'Internal skill registry',
    homepage: 'https://registry.example.com',
    capabilities: ['skills'],
  },

  async search({ capability, query, limit }) {
    if (capability !== 'skills') return { items: [] };

    const res = await fetch(`https://registry.example.com/api/search?q=${query ?? ''}`);
    const data = await res.json();

    return {
      items: data.results.map((r: any) => ({
        id: r.id,
        capability: 'skills',
        title: r.name,
        description: r.summary,
        author: r.author,
      })),
      total: data.total,
    };
  },

  async view({ capability, id }) {
    const res = await fetch(`https://registry.example.com/api/items/${id}`);
    const data = await res.json();

    return {
      id,
      capability: 'skills',
      title: data.name,
      description: data.summary,
      author: data.author,
      preview: data.readme,
      installSnippet: {
        id: data.slug,
        type: 'github',
        def: { repo: `${data.owner}/${data.repo}@${data.slug}` },
      },
    };
  },
};

export default adapter;
```

## Tips

- **Type definitions are inline.** Each adapter file includes its own type definitions so it works anywhere — no external dependencies needed.
- **The `id` in the manifest must be unique** across all loaded adapters. If two adapters declare the same `id`, the second one is skipped and surfaced as a failure on `capa registry list`.
- **Capa caches adapters by `(file mtime, DB updated_at)`.** Re-running `capa registry refresh <slug>` (or hitting **Refresh** in the UI) re-downloads the adapter and bumps both — restart the server for a fully clean reload.
- **Timeouts.** Each `search()` and `view()` call has a 15-second timeout. If your upstream API is slow, consider caching responses in the adapter (see `cursor-marketplace.ts` for an example with a 5-minute in-memory cache).
- **Return early for unsupported capabilities.** If your adapter only supports `'skills'`, return `{ items: [] }` from `search()` and throw from `view()` when called with `'plugins'`.
- **The `preview` field is rendered as Markdown** in the UI and sanitized with DOMPurify. You can return full SKILL.md content, or build a markdown string dynamically.
- **CLI install.** Users can install items directly via `capa add <slug>:<itemId>` (for skills) where `<slug>` is the slug shown by `capa registry list`. For plugins, the YAML snippet in the UI is the primary install method.

## Examples

| File | Registry | Capabilities | Notes |
|------|----------|-------------|-------|
| `skills-sh.ts` | [skills.sh](https://skills.sh) | Skills | Server-side search via API |
| `cursor-marketplace.ts` | [Cursor Marketplace](https://cursor.com/marketplace) | Plugins | Client-side filtering with in-memory cache |
| `claude-plugins.ts` | [Claude Plugins](https://claude.com/plugins) | Plugins | Scrapes the Webflow-rendered directory; resolves source repos via `marketplace.json` |
