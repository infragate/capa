/**
 * Example registry adapter for skills.sh
 *
 * Usage: copy this file into ~/.capa/registries/skills-sh.ts
 *
 * API shape (confirmed against live responses):
 *   Search: GET https://skills.sh/api/search?q=<2+ chars>&limit=N
 *     → { skills: [{ id, skillId, name, installs, source }], count, query }
 *   Download: GET https://skills.sh/api/download/<owner>/<repo>/<slug>
 *     → { files: [{ path, contents }] }
 */

/* ---- Inline type definitions (keep adapter files self-contained) ---- */

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
    id: 'skills-sh',
    name: 'Skills.sh',
    description: 'Public skill registry by Vercel',
    homepage: 'https://skills.sh',
    icon: 'https://www.skills.sh/favicon.ico',
    capabilities: ['skills'],
  },

  async search({ capability, query, limit }) {
    if (capability !== 'skills') return { items: [] };

    const q = (!query || query.length < 2) ? 'anthropic' : query;

    const url = new URL('https://skills.sh/api/search');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(limit ?? 20));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`skills.sh search failed: ${res.status}`);
    const data: any = await res.json();

    const items: RegistryItemSummary[] = (data.skills ?? []).map((r: any) => {
      // r.id = "owner/repo/slug", r.source = "owner/repo", r.skillId = slug
      const parts = (r.id as string).split('/');
      const owner = parts[0];
      const repo = parts.slice(1, -1).join('/');
      const slug = r.skillId ?? parts[parts.length - 1];

      return {
        id: r.id,
        capability: 'skills' as RegistryCapability,
        title: r.name ?? slug,
        description: r.installs != null ? `${r.installs.toLocaleString()} installs` : undefined,
        author: owner,
        homepage: `https://www.skills.sh/${owner}/${repo}/${slug}`,
      };
    });

    return { items, total: data.count };
  },

  async view({ capability, id }) {
    if (capability !== 'skills') {
      throw new Error(`Unsupported capability: ${capability}`);
    }

    // id format: "owner/repo/slug"
    const parts = id.split('/');
    if (parts.length < 3) {
      throw new Error(`Invalid item id: ${id} (expected owner/repo/slug)`);
    }
    const owner = parts[0];
    const repo = parts.slice(1, -1).join('/');
    const slug = parts[parts.length - 1];

    const res = await fetch(
      `https://skills.sh/api/download/${owner}/${repo}/${slug}`,
    );
    if (!res.ok) throw new Error(`skills.sh download failed: ${res.status}`);
    const data: any = await res.json();

    // The download API returns { files: [{ path, contents }] }
    // Find the SKILL.md or fall back to the first file
    const files: { path: string; contents: string }[] = data.files ?? [];
    const skillFile = files.find((f) => f.path.toUpperCase() === 'SKILL.MD')
      ?? files[0];
    const preview = skillFile?.contents ?? '';

    const detail: RegistryItemDetail = {
      id,
      capability: 'skills',
      title: slug,
      author: owner,
      homepage: `https://www.skills.sh/${owner}/${repo}/${slug}`,
      preview,
      files: files.map((f) => f.path),
      installSnippet: {
        id: slug,
        type: 'github',
        def: {
          repo: `${owner}/${repo}@${slug}`,
        },
      },
    };

    return detail;
  },
};

export default adapter;
