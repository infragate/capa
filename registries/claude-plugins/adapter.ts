/**
 * Registry adapter for Anthropic's official Claude plugin marketplace.
 *
 * Source: https://github.com/anthropics/claude-plugins-official
 * Directory: https://claude.com/marketplace/plugins
 *
 * Claude Plugins are bundles of MCP servers, skills, agents, hooks, and
 * commands that install in Claude Code (and Claude Cowork) with a single
 * `claude plugin install <name>@claude-plugins-official` command.
 *
 * Both search and view read the marketplace manifest at
 * `anthropics/claude-plugins-official/.claude-plugin/marketplace.json`,
 * the same file Claude Code resolves plugins from. It lists every plugin
 * with its description, category, author, and canonical `(repo, path, sha)`
 * source. Earlier versions scraped the claude.com directory HTML, which
 * stopped matching when the directory moved to /marketplace/plugins.
 *
 * Install snippets use `type: 'github'` with `def: { repo, ref? }`, where
 * `repo` uses capa's combined form: typically `owner/repo@plugin-name`
 * (recursive search by basename), falling back to `owner/repo::path` when
 * the source path's leaf doesn't match the plugin id. Sources that aren't
 * on GitHub fall back to a `type: 'inline'` snippet that capa skips.
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

/* ---- Adapter implementation ---- */

const BASE_URL = 'https://claude.com';
const DEFAULT_MARKETPLACE = 'claude-plugins-official';
const FETCH_TIMEOUT_MS = 10000;
const SUMMARY_PREVIEW_CHARS = 600;
const UA =
  'Mozilla/5.0 (compatible; capa-registry-claude-plugins/1.0; +https://capa.sh)';

// Anthropic's official plugin marketplace manifest. We pin to `main`
// because that's what Claude Code itself reads when resolving the marketplace.
const MARKETPLACE_REPO = 'anthropics/claude-plugins-official';
const MARKETPLACE_JSON_URL = `https://raw.githubusercontent.com/${MARKETPLACE_REPO}/main/.claude-plugin/marketplace.json`;
const MARKETPLACE_CACHE_TTL_MS = 10 * 60 * 1000;

/* ---- HTTP helpers ---- */

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json,*/*' },
    });
  } finally {
    clearTimeout(timer);
  }
}

function isUnreachable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /abort|timeout|fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(msg);
}
function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '…';
}

/* =========================================================================
 * marketplace.json — resolve plugin sources via the official manifest
 * ========================================================================= */

/* ---- Marketplace manifest (anthropics/claude-plugins-official) ---- */

/**
 * The source field on a marketplace.json plugin record has 5 shapes in
 * the wild. We model them as a tagged union so the URI translator can
 * exhaustively switch on `kind` and the parser stays defensive against
 * shape drift.
 */
type MarketplaceSource =
  | { kind: 'monorepo-local'; path: string } // string: "./plugins/<name>"
  | { kind: 'git-subdir'; url: string; path: string; ref?: string; sha?: string }
  | { kind: 'url'; url: string; sha?: string }
  | { kind: 'url-with-path'; url: string; path: string; ref?: string; sha?: string }
  | { kind: 'repo'; repo: string; commit?: string; sha?: string }
  | { kind: 'unknown'; raw: unknown };

interface MarketplacePlugin {
  name: string;
  description?: string;
  author?: { name?: string; email?: string };
  category?: string;
  homepage?: string;
  source: MarketplaceSource;
  raw: any;
}

interface MarketplaceCache {
  byName: Map<string, MarketplacePlugin>;
  loadedAt: number;
}

let marketplaceCache: MarketplaceCache | null = null;
let inflightMarketplace: Promise<MarketplaceCache | null> | null = null;

function classifySource(raw: unknown): MarketplaceSource {
  if (typeof raw === 'string') {
    // Marketplace-relative path, e.g. "./plugins/frontend-design".
    return { kind: 'monorepo-local', path: raw.replace(/^\.\/?/, '') };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const sourceTag = typeof o.source === 'string' ? o.source : undefined;
    const url = typeof o.url === 'string' ? o.url : undefined;
    const path = typeof o.path === 'string' ? o.path : undefined;
    const ref = typeof o.ref === 'string' ? o.ref : undefined;
    const sha = typeof o.sha === 'string' ? o.sha : undefined;
    const repo = typeof o.repo === 'string' ? o.repo : undefined;
    const commit = typeof o.commit === 'string' ? o.commit : undefined;

    if (sourceTag === 'git-subdir' && url && path) {
      return { kind: 'git-subdir', url, path, ref, sha };
    }
    if (url && path) {
      // `{source: 'url', url, path, ...}` shape (semgrep, atomic-agents).
      return { kind: 'url-with-path', url, path, ref, sha };
    }
    if (url) {
      return { kind: 'url', url, sha };
    }
    if (repo) {
      return { kind: 'repo', repo, commit, sha };
    }
  }
  return { kind: 'unknown', raw };
}

async function loadMarketplace(): Promise<MarketplaceCache | null> {
  const now = Date.now();
  if (marketplaceCache && now - marketplaceCache.loadedAt < MARKETPLACE_CACHE_TTL_MS) {
    return marketplaceCache;
  }
  if (inflightMarketplace) return inflightMarketplace;

  inflightMarketplace = (async () => {
    let res: Response;
    try {
      res = await fetchWithTimeout(MARKETPLACE_JSON_URL, FETCH_TIMEOUT_MS);
    } catch (err) {
      // GitHub rate-limit or transient outage — degrade to "no marketplace
      // info", which forces the inline-fallback snippet path. We don't
      // want a flaky GH to break the registries tab.
      if (isUnreachable(err)) {
        console.warn('[claude-plugins] marketplace.json unreachable; degrading');
        return null;
      }
      throw err;
    }
    if (!res.ok) {
      console.warn(
        `[claude-plugins] marketplace.json fetch failed: ${res.status}`,
      );
      return null;
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      console.warn('[claude-plugins] marketplace.json parse failed');
      return null;
    }

    const list: any[] = Array.isArray(data?.plugins) ? data.plugins : [];
    const byName = new Map<string, MarketplacePlugin>();
    for (const p of list) {
      const name = typeof p?.name === 'string' ? p.name : undefined;
      if (!name) continue;
      byName.set(name, {
        name,
        description: typeof p.description === 'string' ? p.description : undefined,
        author: p.author && typeof p.author === 'object' ? p.author : undefined,
        category: typeof p.category === 'string' ? p.category : undefined,
        homepage: typeof p.homepage === 'string' ? p.homepage : undefined,
        source: classifySource(p.source),
        raw: p,
      });
    }
    marketplaceCache = { byName, loadedAt: Date.now() };
    return marketplaceCache;
  })().finally(() => {
    inflightMarketplace = null;
  });

  return inflightMarketplace;
}

/**
 * Translate a marketplace.json `source` to the GitHub coordinates capa
 * needs: `(ownerRepo, subpath?, sha?)`. Returns `null` when the source
 * isn't a github.com repo (e.g. a `repo` field that points elsewhere).
 *
 * Capa today only supports `github:owner/repo[:version][#sha]`. Subpath
 * URIs returned here will trigger "Invalid plugin URI" until the
 * subpath proposal lands; we still emit them because they're the
 * forward-compatible answer and the only correct way to identify the
 * plugin source. Callers that want graceful-today behavior can check
 * `subpath != null` and fall back to inline.
 */
interface GithubCoords {
  ownerRepo: string;
  subpath?: string;
  sha?: string;
  ref?: string;
}

function sourceToGithubCoords(src: MarketplaceSource): GithubCoords | null {
  switch (src.kind) {
    case 'monorepo-local':
      return {
        ownerRepo: MARKETPLACE_REPO,
        subpath: src.path.replace(/^\/+/, ''),
      };
    case 'git-subdir':
    case 'url-with-path': {
      const ownerRepo = parseGithubUrl(src.url);
      if (!ownerRepo) return null;
      return {
        ownerRepo,
        subpath: src.path.replace(/^\/+/, ''),
        sha: src.sha,
        ref: src.ref,
      };
    }
    case 'url': {
      const ownerRepo = parseGithubUrl(src.url);
      if (!ownerRepo) return null;
      return { ownerRepo, sha: src.sha };
    }
    case 'repo': {
      // `repo` is sometimes "owner/repo" and sometimes a full URL; handle
      // both. If it's not parseable as a github coordinate, give up.
      if (/^[^/\s]+\/[^/\s]+$/.test(src.repo)) {
        return { ownerRepo: src.repo, sha: src.sha ?? src.commit };
      }
      const ownerRepo = parseGithubUrl(src.repo);
      if (!ownerRepo) return null;
      return { ownerRepo, sha: src.sha ?? src.commit };
    }
    case 'unknown':
      return null;
  }
}

function parseGithubUrl(url: string): string | null {
  // Accept https://github.com/owner/repo[.git], git@github.com:owner/repo[.git],
  // or already-bare "owner/repo" forms.
  const trimmed = url.trim();
  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/,
  );
  if (httpsMatch) return httpsMatch[1];
  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) return trimmed;
  return null;
}

function githubBrowseUrl(c: GithubCoords): string {
  const refish = c.sha ?? c.ref ?? 'main';
  if (c.subpath) {
    return `https://github.com/${c.ownerRepo}/tree/${refish}/${c.subpath}`;
  }
  return `https://github.com/${c.ownerRepo}/tree/${refish}`;
}

/* =========================================================================
 * Rendering — summaries, tags, preview, and install snippets
 * ========================================================================= */

function homepageFor(slug: string): string {
  return `${BASE_URL}/marketplace/plugins/${encodeURIComponent(slug)}`;
}

function titleFor(p: MarketplacePlugin): string {
  return typeof p.raw?.displayName === 'string' && p.raw.displayName
    ? p.raw.displayName
    : p.name;
}

function buildTags(p: MarketplacePlugin): string[] | undefined {
  const tags: string[] = [];
  if (p.category) tags.push(p.category);
  if (Array.isArray(p.raw?.keywords)) {
    for (const k of p.raw.keywords) if (typeof k === 'string') tags.push(k);
  }
  return tags.length > 0 ? unique(tags) : undefined;
}

function toSummary(p: MarketplacePlugin): RegistryItemSummary {
  return {
    id: p.name,
    capability: 'plugins',
    title: titleFor(p),
    description: p.description
      ? truncate(p.description, SUMMARY_PREVIEW_CHARS)
      : undefined,
    author: p.author?.name,
    version: typeof p.raw?.version === 'string' ? p.raw.version : undefined,
    tags: buildTags(p),
    homepage: homepageFor(p.name),
  };
}

function matches(p: MarketplacePlugin, q: string): boolean {
  return [p.name, titleFor(p), p.description, p.category, p.author?.name]
    .concat(Array.isArray(p.raw?.keywords) ? p.raw.keywords : [])
    .some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
}

/** Resolved GitHub coordinates for a plugin's marketplace.json source. */
interface ResolvedSource {
  coords: GithubCoords;
}

function resolvePluginSource(p: MarketplacePlugin): ResolvedSource | null {
  const coords = sourceToGithubCoords(p.source);
  return coords ? { coords } : null;
}

function installCommand(p: MarketplacePlugin): string {
  return `claude plugin install ${p.name}@${DEFAULT_MARKETPLACE}`;
}

/** Markdown preview shown in the registry UI. */
function buildPreview(p: MarketplacePlugin, resolved: ResolvedSource | null): string {
  const parts: string[] = [`# ${titleFor(p)}`, ''];
  if (p.description) parts.push(p.description, '');

  const meta: string[] = [];
  if (p.author?.name) meta.push(`**Author:** ${p.author.name}`);
  if (p.category) meta.push(`**Category:** ${p.category}`);
  meta.push(`**Marketplace:** \`${DEFAULT_MARKETPLACE}\``);
  if (p.homepage) meta.push(`**Homepage:** ${p.homepage}`);
  if (resolved) {
    const c = resolved.coords;
    meta.push(
      `**Source:** [${c.ownerRepo}${c.subpath ? `/${c.subpath}` : ''}](${githubBrowseUrl(c)})`,
    );
  }
  parts.push(meta.join('  \n'), '');

  parts.push('## Install', '', 'Install via capa:', '', '```');
  parts.push(`capa add claude-plugins:${p.name}`, '```', '');
  parts.push('Or in Claude Code:', '', '```', installCommand(p), '```');
  return parts.join('\n');
}

/**
 * Build the install snippet capa will paste into `capabilities.yaml`.
 *
 *   1. `type: 'github'` with `def: { repo, version?, ref? }` when the source
 *      resolves to GitHub. The repo string uses capa's combined form:
 *      `owner/repo@plugin-name` for a recursive search on the plugin's
 *      directory basename, or `owner/repo::path/to/plugin` when that
 *      basename doesn't match the plugin id.
 *
 *   2. `type: 'inline'` when it doesn't. capa skips inline plugin entries
 *      silently; the slash command stays in `def.command` for the UI.
 */
function buildInstallSnippet(
  p: MarketplacePlugin,
  resolved: ResolvedSource | null,
): Record<string, unknown> {
  if (resolved) {
    const { ownerRepo, subpath, sha, ref } = resolved.coords;
    let repoString = ownerRepo;
    if (subpath) {
      const leaf = subpath.replace(/\/+$/, '').split('/').pop() ?? subpath;
      repoString = leaf === p.name ? `${ownerRepo}@${p.name}` : `${ownerRepo}::${subpath}`;
    }
    const def: Record<string, unknown> = { repo: repoString };
    if (sha) def.ref = sha;
    else if (ref) def.version = ref;
    return { id: p.name, type: 'github', def };
  }

  const def: Record<string, unknown> = {
    plugin: p.name,
    marketplace: DEFAULT_MARKETPLACE,
    command: installCommand(p),
    homepage: homepageFor(p.name),
  };
  if (p.description) def.description = truncate(p.description, 240);
  return { id: p.name, type: 'inline', def };
}

/* =========================================================================
 * Adapter object — RegistryAdapter implementation exported to capa
 * ========================================================================= */

const adapter: RegistryAdapter = {
  manifest: {
    id: 'claude-plugins',
    name: 'Claude Plugins',
    description:
      'Anthropic-curated plugins for Claude Code and Cowork (one-shot install of MCP servers, skills, agents, hooks, and commands)',
    homepage: `${BASE_URL}/marketplace/plugins`,
    icon: 'https://claude.com/favicon.ico',
    capabilities: ['plugins'],
  },

  async search({ capability, query, limit }) {
    if (capability !== 'plugins') return { items: [], total: 0 };
    // Unreachable GitHub degrades to an empty tab rather than an error.
    const marketplace = await loadMarketplace();
    if (!marketplace) return { items: [], total: 0 };

    const q = (query ?? '').trim().toLowerCase();
    const all = Array.from(marketplace.byName.values());
    const filtered = q ? all.filter((p) => matches(p, q)) : all;
    const sliced =
      typeof limit === 'number' && limit > 0 ? filtered.slice(0, limit) : filtered;
    return { items: sliced.map(toSummary), total: filtered.length };
  },

  async view({ capability, id }) {
    if (!id) throw new Error('Missing item id');
    if (capability !== 'plugins') {
      throw new Error(`Unsupported capability for claude-plugins: ${capability}`);
    }
    const marketplace = await loadMarketplace();
    if (!marketplace) {
      throw new Error(
        'The Claude plugins marketplace is unreachable. Check your network and try again.',
      );
    }
    const p = marketplace.byName.get(id);
    if (!p) throw new Error(`Claude plugin "${id}" not found`);

    const resolved = resolvePluginSource(p);
    const tags = unique([
      ...(buildTags(p) ?? []),
      resolved ? 'source-resolved' : 'source-unresolved',
    ]);
    return {
      ...toSummary(p),
      tags,
      preview: buildPreview(p, resolved),
      installSnippet: buildInstallSnippet(p, resolved),
    };
  },
};

export default adapter;
