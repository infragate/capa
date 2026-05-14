/**
 * Registry adapter for the Cursor marketplace
 *
 * Usage: copy this file into ~/.capa/registries/cursor-marketplace.ts
 *
 * API shape (confirmed against live responses):
 *   List: POST https://cursor.com/api/dashboard/list-marketplace-plugins
 *     body: { query: "", limit: 500 }
 *     → { plugins: [{ id, name, displayName, description, logoUrl,
 *          publisher: { name, displayName, logoUrl }, gitUrl, gitRef,
 *          gitPath, skills, mcpServers, curatedCategoryKeys, ... }] }
 *
 *   The API does NOT support server-side search — it always returns the
 *   full list regardless of `query`. Filtering is done in-memory here.
 */

import type {
  RegistryAdapter,
  RegistryItemSummary,
  RegistryItemDetail,
  RegistryCapability,
} from '../../src/types/registry';

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v || undefined;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return (typeof o.displayName === 'string' && o.displayName ? o.displayName : undefined)
        ?? (typeof o.name === 'string' && o.name ? o.name : undefined);
  }
  return String(v);
}

function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((x) => typeof x === 'string' ? x : str(x) ?? '').filter(Boolean);
}

function pluginUri(gitUrl: string | undefined): string | undefined {
  if (!gitUrl) return undefined;
  const m = gitUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return `github:${m[1]}/${m[2]}`;
  const g = gitUrl.match(/gitlab\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (g) return `gitlab:${g[1]}/${g[2]}`;
  return undefined;
}

function formatCategory(key: string): string {
  return key
    .replace(/^[A-Z_]+$/, (s) => s.toLowerCase())
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function iconUrl(p: any): string | undefined {
  if (typeof p.logoUrl === 'string' && p.logoUrl) return p.logoUrl;
  if (p.publisher && typeof p.publisher === 'object') {
    const pub = p.publisher as Record<string, unknown>;
    if (typeof pub.logoUrl === 'string' && pub.logoUrl) return pub.logoUrl;
  }
  return undefined;
}

function toSummary(p: any): RegistryItemSummary {
  const publisherName = str(p.publisher) ?? '';
  return {
    id: String(p.id ?? p.name),
    capability: 'plugins' as RegistryCapability,
    title: p.displayName ?? p.name ?? String(p.id),
    description: str(p.description),
    author: publisherName,
    icon: iconUrl(p),
    tags: strArr(p.curatedCategoryKeys)?.map(formatCategory),
    homepage: `https://cursor.com/marketplace/${publisherName.toLowerCase().replace(/\s+/g, '-')}/${p.name ?? p.id}`,
  };
}

let cachedPlugins: any[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function fetchAll(): Promise<any[]> {
  if (cachedPlugins && Date.now() - cacheTime < CACHE_TTL) return cachedPlugins;
  const res = await fetch('https://cursor.com/api/dashboard/list-marketplace-plugins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '', limit: 500 }),
  });
  if (!res.ok) throw new Error(`Cursor marketplace fetch failed: ${res.status}`);
  const data: any = await res.json();
  cachedPlugins = data.plugins ?? [];
  cacheTime = Date.now();
  return cachedPlugins!;
}

const adapter: RegistryAdapter = {
  manifest: {
    id: 'cursor-marketplace',
    name: 'Cursor Marketplace',
    description: 'Official Cursor plugin marketplace',
    homepage: 'https://cursor.com/marketplace',
    icon: 'https://cursor.com/favicon.ico',
    capabilities: ['plugins'],
  },

  async search({ capability, query, limit }) {
    if (capability !== 'plugins') return { items: [] };

    const all = await fetchAll();

    let filtered = all;
    if (query && query.trim()) {
      const q = query.toLowerCase();
      filtered = all.filter((p) => {
        const name = (p.displayName ?? p.name ?? '').toLowerCase();
        const desc = (typeof p.description === 'string' ? p.description : '').toLowerCase();
        const pub = str(p.publisher)?.toLowerCase() ?? '';
        return name.includes(q) || desc.includes(q) || pub.includes(q);
      });
    }

    const items = filtered
      .slice(0, limit ?? 20)
      .map(toSummary);

    return { items, total: filtered.length };
  },

  async view({ capability, id }) {
    if (capability !== 'plugins') {
      throw new Error(`Unsupported capability: ${capability}`);
    }

    const all = await fetchAll();
    const p = all.find((x: any) => String(x.id) === id || x.name === id);
    if (!p) throw new Error(`Plugin "${id}" not found`);

    const uri = pluginUri(p.gitUrl);
    const publisherName = str(p.publisher) ?? '';
    const description = str(p.description) ?? '';

    const previewParts: string[] = [];
    previewParts.push(`# ${p.displayName ?? p.name}\n`);
    if (description) previewParts.push(`${description}\n`);
    if (p.skills?.length) {
      previewParts.push(`## Skills\n`);
      for (const s of p.skills) {
        previewParts.push(`- **${s.name}** — ${s.description ?? ''}`);
      }
      previewParts.push('');
    }
    if (p.mcpServers?.length) {
      previewParts.push(`## MCP Servers\n`);
      for (const m of p.mcpServers) {
        previewParts.push(`- **${m.name}**`);
      }
      previewParts.push('');
    }

    const detail: RegistryItemDetail = {
      ...toSummary(p),
      preview: previewParts.join('\n'),
      installSnippet: {
        type: 'remote',
        def: {
          uri: uri ?? `github:${p.name ?? p.id}`,
        },
      },
    };

    return detail;
  },
};

export default adapter;
