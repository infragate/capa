/**
 * Registry adapter for the Claude Plugins directory (claude.com/plugins).
 *
 * Source: https://claude.com/plugins
 *
 * Claude Plugins are bundles of MCP servers, skills, agents, hooks, and
 * commands that install in Claude Code (and Claude Cowork) with a single
 * `claude plugin install <name>@<marketplace>` slash command. Anthropic's
 * official marketplace is `claude-plugins-official`; community plugins
 * also live there once accepted. Each plugin has a marketing page on
 * claude.com/plugins/<slug>.
 *
 * The directory is rendered through Webflow CMS — there is no public JSON
 * API — so this adapter scrapes the listing and detail pages. The HTML is
 * stable because Webflow drives on-page filtering through Finsweet
 * `fs-list-field` markers, which Anthropic uses for the directory itself.
 *
 * Capa is a coding-agent capability manager and Claude plugins map cleanly
 * to capa's `plugins` capability. Install snippets use `type: 'github'`
 * with `def: { repo, ref? }`, where `repo` uses capa's combined form —
 * typically `owner/repo@plugin-name` (recursive search by basename) and
 * falling back to `owner/repo::path/to/plugin` when the marketplace's
 * source path's leaf doesn't match the plugin id. Coordinates are resolved
 * through the official marketplace manifest at
 * `anthropics/claude-plugins-official/.claude-plugin/marketplace.json`,
 * which gives us the canonical `(repo, path, sha)` triple per plugin.
 *
 * Plugins that aren't in marketplace.json (typically very recent
 * submissions) fall back to a `type: 'inline'` snippet that capa
 * silently skips, so the registry tab stays clean and users still see
 * the slash command in the preview.
 *
 * HTML shapes (confirmed against live responses):
 *
 *   GET /plugins[?<token>_page=<n>]
 *     → HTML page with up to 100 cards. Each card lives in:
 *         <div class="stories_cms_item w-dyn-item">
 *           <div class="u-display-none">
 *             <div fs-list-field="works-with">Claude Code</div>...
 *             <div fs-list-field="date">...</div>
 *           </div>
 *           <a href="/plugins/<slug>" ...>
 *             <h3 fs-list-field="name"><name></h3>
 *             <p>...tagline...</p>
 *             <div class="connector_card-stats">
 *               <svg>...</svg>
 *               [<div>Anthropic verified</div>]?     // if verified
 *               <svg>...</svg>
 *               <div>1234</div><div>installs</div>
 *             </div>
 *           </a>
 *         </div>
 *       Pagination uses <a href="?<token>_page=<n>" class="w-pagination-next">.
 *
 *   GET /plugins/<slug>
 *     → HTML page with:
 *         <h1>...title...</h1>
 *         <a class="header_stories_link is-copy-link"
 *            data-copy="claude plugin install <slug>@<marketplace>">
 *           <div>Claude Code</div>
 *         </a>
 *         <div class="w-richtext"><p>...long body...</p></div>
 *         <div>Anthropic verified</div>?              // if verified
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
const LISTING_PATH = '/plugins';
const DEFAULT_MARKETPLACE = 'claude-plugins-official';
const FETCH_TIMEOUT_MS = 10000;
// Webflow throttles unauthenticated bursts; cap concurrent page fetches.
const PAGE_CONCURRENCY = 4;
// Hard ceiling on listing pages we'll crawl (current directory is 3 pages
// at 100 plugins each — keep generous headroom).
const MAX_LISTING_PAGES = 50;
// Cache the full listing across calls — searches filter the cache locally.
const LIST_CACHE_TTL_MS = 10 * 60 * 1000;
const SUMMARY_PREVIEW_CHARS = 600;
const UA =
  'Mozilla/5.0 (compatible; capa-registry-claude-plugins/1.0; +https://capa.infragate.ai)';

// Anthropic's official plugin marketplace manifest — the source of truth
// for `(repo, path, sha)` per plugin. We pin to `main` because that's
// what Claude Code itself reads when resolving the marketplace.
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
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    });
  } finally {
    clearTimeout(timer);
  }
}

function isUnreachable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /abort|timeout|fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(msg);
}

/* ---- HTML helpers (regex-based; no DOM dependency) ---- */

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'",
  '#x2F': '/',
  '#x60': '`',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
    const named = HTML_ENTITIES[ent];
    if (named !== undefined) return named;
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const code = parseInt(ent.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    if (ent.startsWith('#')) {
      const code = parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

function stripTags(html: string): string {
  // Replace block-level closers with newlines so paragraphs survive, then
  // drop everything else. Webflow's rich-text editor sprinkles zero-width
  // joiners (U+200D) between paragraphs as anchor characters; strip them
  // along with NBSP and BOM noise so the preview reads cleanly.
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '…';
}

/* ---- Listing parser ---- */

interface ListingCard {
  id: string;
  title: string;
  description?: string;
  worksWith: string[];
  installs?: number;
  verified: boolean;
}

/**
 * Parse the plugins index HTML into card summaries. We split on the
 * `stories_cms_item` listitem boundary (the wrapper Webflow emits per CMS
 * row) so each chunk has a 1:1 mapping with a card and we don't accidentally
 * cross-pollinate metadata between cards.
 */
function parseListing(html: string): ListingCard[] {
  const ITEM_BOUNDARY =
    /<div role="listitem" class="stories_cms_item w-dyn-item">/g;
  const parts = html.split(ITEM_BOUNDARY).slice(1);
  const cards: ListingCard[] = [];
  for (const part of parts) {
    const card = parseCard(part);
    if (card) cards.push(card);
  }
  return cards;
}

function parseCard(chunk: string): ListingCard | null {
  const slugMatch = chunk.match(/href="\/plugins\/([^"#?]+)"/);
  if (!slugMatch) return null;
  const id = decodeURIComponent(slugMatch[1]);

  const titleMatch = chunk.match(
    /<h3[^>]*fs-list-field="name"[^>]*>([^<]+)<\/h3>/,
  );
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : id;

  const taglineMatch = chunk.match(
    /<h3[^>]*fs-list-field="name"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/,
  );
  const description = taglineMatch
    ? decodeEntities(taglineMatch[1]).replace(/\s+/g, ' ').trim()
    : undefined;

  const worksWith = unique(
    Array.from(chunk.matchAll(/fs-list-field="works-with"[^>]*>([^<]+)</g)).map(
      (m) => decodeEntities(m[1]).trim(),
    ),
  );

  // Verified badge appears only when the card is "Anthropic verified".
  // The badge text lives in a u-text-style-caption div inside the
  // connector_card-stats block (we filter on connector_card-stats so we
  // don't pick up the FAQ paragraph that mentions the badge).
  const statsMatch = chunk.match(
    /<div class="connector_card-stats">([\s\S]*?)<\/a>/,
  );
  const stats = statsMatch ? statsMatch[1] : '';
  const verified = /Anthropic verified/.test(stats);

  // Install count is the first numeric div directly preceding the
  // "installs" label inside the stats block.
  const installsMatch = stats.match(
    />(\d+)<\/div>\s*<div[^>]*>\s*installs/,
  );
  const installs = installsMatch ? Number(installsMatch[1]) : undefined;

  return { id, title, description, worksWith, installs, verified };
}

/**
 * Detect Webflow's per-collection pagination param token (e.g. `cc61befa`)
 * from the "Next Page" link. The token regenerates on Webflow republishes
 * but only when the collection rebuilds, so we fish it out at runtime
 * rather than hard-coding it.
 */
function findPaginationToken(html: string): string | undefined {
  const m = html.match(
    /<a[^>]*href="\?([a-f0-9]+)_page=\d+"[^>]*class="[^"]*w-pagination-next/,
  );
  return m ? m[1] : undefined;
}

/** Warn when Webflow pagination markup is present but the token can't be parsed. */
function warnPaginationParseFailure(html: string, token: string | undefined): void {
  if (token) return;
  if (!/w-pagination-next/.test(html)) return;

  const nextLink =
    html.match(/<a[^>]*class="[^"]*w-pagination-next[^"]*"[^>]*>[\s\S]{0,120}/)?.[0] ??
    html.match(/<a[^>]*href="[^"]*_page=\d+"[^>]*>[\s\S]{0,120}/)?.[0] ??
    'w-pagination-next present';
  console.warn(
    `[claude-plugins] pagination parsing failed; only first page returned (${nextLink.replace(/\s+/g, ' ').slice(0, 200)})`,
  );
}

/* ---- Listing cache ---- */

interface ListingCache {
  cards: ListingCard[];
  byId: Map<string, ListingCard>;
  loadedAt: number;
}

let listingCache: ListingCache | null = null;
let inflightListing: Promise<ListingCache> | null = null;

async function loadListing(): Promise<ListingCache> {
  const now = Date.now();
  if (listingCache && now - listingCache.loadedAt < LIST_CACHE_TTL_MS) {
    return listingCache;
  }
  if (inflightListing) return inflightListing;

  inflightListing = (async () => {
    const all: ListingCard[] = [];

    // Fetch page 1 first to discover the pagination token. After that,
    // fan out remaining pages in small concurrent batches.
    const page1Html = await fetchListingPage();
    const token = findPaginationToken(page1Html);
    warnPaginationParseFailure(page1Html, token);
    all.push(...parseListing(page1Html));

    if (token) {
      let nextPage = 2;
      let stopped = false;
      while (!stopped && nextPage <= MAX_LISTING_PAGES) {
        const batchPages: number[] = [];
        for (let i = 0; i < PAGE_CONCURRENCY && nextPage + i <= MAX_LISTING_PAGES; i++) {
          batchPages.push(nextPage + i);
        }
        const batchHtmls = await Promise.all(
          batchPages.map((p) => fetchListingPage(token, p)),
        );
        for (const html of batchHtmls) {
          const cards = parseListing(html);
          if (cards.length === 0) {
            stopped = true;
            break;
          }
          all.push(...cards);
        }
        nextPage += batchPages.length;
      }
    }

    const byId = new Map<string, ListingCard>();
    for (const c of all) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
    listingCache = {
      cards: Array.from(byId.values()),
      byId,
      loadedAt: Date.now(),
    };
    return listingCache;
  })().finally(() => {
    inflightListing = null;
  });

  return inflightListing;
}

async function fetchListingPage(token?: string, page?: number): Promise<string> {
  const url = new URL(LISTING_PATH, BASE_URL);
  if (token && page && page > 1) {
    url.searchParams.set(`${token}_page`, String(page));
  }
  const urlStr = url.toString();
  try {
    const res = await fetchWithTimeout(urlStr, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      console.warn(
        `[claude-plugins] listing fetch failed: ${urlStr} (${res.status})`,
      );
      throw new Error(`Claude plugins listing failed: ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith('Claude plugins listing failed:')
    ) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[claude-plugins] listing fetch failed: ${urlStr} (${msg})`);
    throw err;
  }
}

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

/* ---- Detail parser ---- */

interface PluginDetail {
  id: string;
  title: string;
  description?: string;
  worksWith: string[];
  longDescription?: string;
  installCommand?: string;
  pluginName?: string;
  marketplace?: string;
  installRuntime?: string;
  verified: boolean;
}

function parseDetail(id: string, html: string): PluginDetail {
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = titleMatch ? stripTags(titleMatch[1]).trim() : id;

  // Long description: the longest .w-richtext block (the body). Smaller
  // blocks contain the marginalia / footer copy.
  const richBlocks = Array.from(
    html.matchAll(
      /<div[^>]*class="[^"]*w-richtext[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
    ),
  ).map((m) => m[1]);
  let longDescription: string | undefined;
  if (richBlocks.length > 0) {
    const cleaned = richBlocks
      .map((b) => stripTags(b))
      .filter((s) => s.length > 0)
      .sort((a, b) => b.length - a.length);
    if (cleaned.length > 0) longDescription = cleaned[0];
  }

  const worksWith = unique(
    Array.from(html.matchAll(/fs-list-field="works-with"[^>]*>([^<]+)</g)).map(
      (m) => decodeEntities(m[1]).trim(),
    ),
  );

  // The install command is stored on a `data-copy` attribute on the
  // "Install in" CTA. The runtime label (Claude Code / Cowork) lives in
  // the sibling rich-text div. We find both via a single combined match
  // so we only pick up the genuine install CTA, not arbitrary copy
  // buttons elsewhere on the page.
  const installCtaMatch = html.match(
    /data-copy="([^"]+)"[^>]*class="u-rich-text u-text-style-body-3"[^>]*>([^<]+)</,
  );
  let installCommand: string | undefined;
  let installRuntime: string | undefined;
  if (installCtaMatch) {
    installCommand = decodeEntities(installCtaMatch[1]).trim();
    installRuntime = decodeEntities(installCtaMatch[2]).trim();
  } else {
    const cmdOnly = html.match(/data-copy="(claude\s+plugin\s+install\s+[^"]+)"/);
    if (cmdOnly) {
      installCommand = decodeEntities(cmdOnly[1]).trim();
    }
  }

  const parsed = parseInstallCommand(installCommand);

  // Verified badge: only count occurrences inside the hero details block,
  // not the FAQ at the bottom of the page (which always mentions the badge
  // by name when explaining what it means).
  const verified = isVerifiedDetail(html);

  return {
    id,
    title,
    description: longDescription
      ? truncate(longDescription.split(/\n+/)[0], SUMMARY_PREVIEW_CHARS)
      : undefined,
    worksWith,
    longDescription,
    installCommand,
    pluginName: parsed?.pluginName,
    marketplace: parsed?.marketplace,
    installRuntime,
    verified,
  };
}

/**
 * Parse a "claude plugin install <name>@<marketplace>" command into its
 * parts. The marketplace is optional in the slash command (defaults to
 * `claude-plugins-official` when omitted), but Anthropic's directory
 * always includes it.
 */
function parseInstallCommand(
  cmd?: string,
): { pluginName: string; marketplace: string } | undefined {
  if (!cmd) return undefined;
  const m = cmd.match(
    /plugin\s+install\s+([^@\s]+)(?:@([^\s"]+))?/i,
  );
  if (!m) return undefined;
  return {
    pluginName: m[1],
    marketplace: m[2] ?? DEFAULT_MARKETPLACE,
  };
}

/**
 * The "Anthropic verified" badge appears in the hero stats area (a
 * `u-text-style-caption` div) on verified plugins. Filter out the FAQ
 * paragraph that mentions the badge text on every page footer.
 */
function isVerifiedDetail(html: string): boolean {
  return /class="u-text-style-caption[^"]*"[^>]*>Anthropic verified</.test(
    html,
  );
}

/* ---- Summary / preview rendering ---- */

function homepageFor(slug: string): string {
  return `${BASE_URL}/plugins/${encodeURIComponent(slug)}`;
}

function formatInstalls(n?: number): string | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function buildTags(card: ListingCard): string[] | undefined {
  const tags: string[] = [];
  for (const w of card.worksWith) {
    tags.push(`runs-in:${w.toLowerCase().replace(/\s+/g, '-')}`);
  }
  if (card.verified) tags.push('anthropic-verified');
  if (card.installs != null) {
    const fmt = formatInstalls(card.installs);
    if (fmt) tags.push(`installs:${fmt}`);
  }
  return tags.length > 0 ? unique(tags) : undefined;
}

/**
 * Build tags for the view payload, layering source-resolution status
 * on top of the listing-card tags.
 */
function buildTagsForView(
  merged: PluginDetail,
  card: ListingCard | undefined,
  worksWith: string[],
  resolved: ResolvedSource | null,
): string[] | undefined {
  const base = card
    ? buildTags({ ...card, worksWith }) ?? []
    : buildTags({
        id: merged.id,
        title: merged.title,
        description: merged.description,
        worksWith,
        verified: merged.verified,
      }) ?? [];
  const extra: string[] = [];
  if (resolved) {
    extra.push('source-resolved');
  } else {
    extra.push('source-unresolved');
  }
  const tags = unique([...base, ...extra]);
  return tags.length > 0 ? tags : undefined;
}

function toCardSummary(card: ListingCard): RegistryItemSummary {
  return {
    id: card.id,
    capability: 'plugins',
    title: card.title,
    description: card.description,
    tags: buildTags(card),
    homepage: homepageFor(card.id),
  };
}

/**
 * Build the markdown preview shown in the registry UI.
 */
function buildPreview(
  d: PluginDetail,
  card: ListingCard | undefined,
  resolved: ResolvedSource | null,
): string {
  const parts: string[] = [];
  parts.push(`# ${d.title}`);
  if (d.verified || card?.verified) {
    parts.push('');
    parts.push('_Anthropic verified_');
  }
  parts.push('');

  if (d.longDescription) {
    parts.push(d.longDescription);
    parts.push('');
  }

  const meta: string[] = [];
  const worksWith = unique([...(card?.worksWith ?? []), ...d.worksWith]);
  if (worksWith.length > 0) {
    meta.push(`**Runs in:** ${worksWith.join(', ')}`);
  }
  if (card?.installs != null) {
    meta.push(`**Installs:** ${card.installs.toLocaleString('en-US')}`);
  }
  if (d.marketplace) {
    meta.push(`**Marketplace:** \`${d.marketplace}\``);
  }
  if (resolved?.coords) {
    meta.push(
      `**Source:** [${resolved.coords.ownerRepo}${resolved.coords.subpath ? `/${resolved.coords.subpath}` : ''}](${githubBrowseUrl(resolved.coords)})`,
    );
  }
  if (meta.length > 0) {
    parts.push(meta.join('  \n'));
    parts.push('');
  }

  parts.push('## Install');
  parts.push('');
  parts.push('Install via capa:');
  parts.push('');
  parts.push('```');
  parts.push(`capa add claude-plugins:${d.id}`);
  parts.push('```');

  if (resolved?.coords) {
    parts.push('');
    parts.push('## Source code');
    parts.push('');
    parts.push(
      `Resolved through [\`${MARKETPLACE_REPO}/.claude-plugin/marketplace.json\`](https://github.com/${MARKETPLACE_REPO}/blob/main/.claude-plugin/marketplace.json) to:`,
    );
    parts.push('');
    parts.push(`- **Repository:** [${githubBrowseUrl(resolved.coords)}](${githubBrowseUrl(resolved.coords)})`);
    if (resolved.coords.subpath) {
      parts.push(`- **Subdirectory:** \`${resolved.coords.subpath}\``);
    }
    if (resolved.coords.sha) {
      parts.push(`- **Pinned commit:** \`${resolved.coords.sha.slice(0, 12)}\``);
    } else if (resolved.coords.ref) {
      parts.push(`- **Pinned ref:** \`${resolved.coords.ref}\``);
    }
  } else if (d.installCommand) {
    parts.push('');
    parts.push('## Source code');
    parts.push('');
    parts.push(
      `Not listed in [\`${MARKETPLACE_REPO}/.claude-plugin/marketplace.json\`](https://github.com/${MARKETPLACE_REPO}/blob/main/.claude-plugin/marketplace.json) — the plugin is likely too new for the cached snapshot. Use the slash command above to install through Claude Code, which will resolve the latest marketplace state.`,
    );
  }

  return parts.join('\n');
}

/**
 * Resolution result for a plugin's source. Either we resolved coords
 * (full or partial), or we couldn't (plugin not in marketplace.json or
 * its source field doesn't point at github).
 */
interface ResolvedSource {
  coords: GithubCoords;
}

function resolvePluginSource(
  pluginName: string,
  marketplace: MarketplaceCache | null,
): ResolvedSource | null {
  if (!marketplace) return null;
  const record = marketplace.byName.get(pluginName);
  if (!record) return null;
  const coords = sourceToGithubCoords(record.source);
  if (!coords) return null;
  return { coords };
}

/**
 * Build the install snippet capa will paste into `capabilities.yaml`.
 *
 * Two shapes:
 *
 *   1. `type: 'github'` with `def: { repo, version?, ref? }` when we resolved
 *      the source through marketplace.json. The repo string uses capa's
 *      combined form — `owner/repo@plugin-name` for a recursive search on
 *      the plugin's directory basename, or `owner/repo::path/to/plugin`
 *      when that basename is ambiguous (mismatched id / source path).
 *
 *   2. `type: 'inline'` for unresolved plugins. capa skips inline
 *      plugin entries silently, so users get no warning even when the
 *      adapter can't pin the source. The slash command stays in
 *      `def.command` so the registry UI can still copy it.
 */
function buildInstallSnippet(
  d: PluginDetail,
  resolved: ResolvedSource | null,
): Record<string, unknown> {
  const pluginName = d.pluginName ?? d.id;
  const marketplace = d.marketplace ?? DEFAULT_MARKETPLACE;
  const command = d.installCommand ?? `claude plugin install ${pluginName}@${marketplace}`;

  if (resolved) {
    const { ownerRepo, subpath, sha, ref } = resolved.coords;
    // Prefer the `@plugin-name` recursive-search form whenever the plugin's
    // directory basename matches its id — keeps the YAML short and survives
    // upstream reorganizations of `plugins/`. Fall back to `::<path>` when
    // the basename doesn't match (`d.id` differs from the leaf segment).
    let repoString = ownerRepo;
    if (subpath) {
      const leaf = subpath.replace(/\/+$/, '').split('/').pop() ?? subpath;
      repoString = leaf === d.id ? `${ownerRepo}@${d.id}` : `${ownerRepo}::${subpath}`;
    }
    const def: Record<string, unknown> = { repo: repoString };
    if (sha) def.ref = sha;
    else if (ref) def.version = ref;
    return {
      id: d.id,
      type: 'github',
      def,
    };
  }

  const description = d.longDescription
    ? truncate(d.longDescription.split(/\n+/)[0], 240)
    : undefined;
  const def: Record<string, unknown> = {
    plugin: pluginName,
    marketplace,
    command,
    homepage: homepageFor(d.id),
  };
  if (d.installRuntime) def.runtime = d.installRuntime;
  if (description) def.description = description;
  return {
    id: d.id,
    type: 'inline',
    def,
  };
}

/* ---- Adapter object ---- */

const adapter: RegistryAdapter = {
  manifest: {
    id: 'claude-plugins',
    name: 'Claude Plugins',
    description:
      'Anthropic-curated plugins for Claude Code and Cowork (one-shot install of MCP servers, skills, agents, hooks, and commands)',
    homepage: `${BASE_URL}/plugins`,
    icon: 'https://claude.com/favicon.ico',
    capabilities: ['plugins'],
  },

  async search({ capability, query, limit }) {
    if (capability !== 'plugins') {
      return { items: [], total: 0 };
    }
    let cache: ListingCache;
    try {
      cache = await loadListing();
    } catch (err) {
      // Treat the listing as transiently unavailable — return empty rather
      // than blowing up the registries tab if claude.com hiccups or the
      // network is offline.
      if (isUnreachable(err)) {
        console.warn('[claude-plugins] listing unreachable; returning empty');
        return { items: [], total: 0 };
      }
      throw err;
    }

    const q = (query ?? '').trim().toLowerCase();
    const filtered = q
      ? cache.cards.filter((c) => cardMatches(c, q))
      : cache.cards;

    // Default ordering matches Webflow's listing (sorted by install count
    // desc, which is also the order we crawled). Keep it.
    const total = filtered.length;
    const sliced = typeof limit === 'number' && limit > 0
      ? filtered.slice(0, limit)
      : filtered;
    return {
      items: sliced.map(toCardSummary),
      total,
    };
  },

  async view({ capability, id }) {
    if (!id) throw new Error('Missing item id');
    if (capability !== 'plugins') {
      throw new Error(
        `Unsupported capability for claude-plugins: ${capability}`,
      );
    }

    const url = `${BASE_URL}/plugins/${encodeURIComponent(id)}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    } catch (err) {
      if (isUnreachable(err)) {
        throw new Error(
          'Claude.com is unreachable. Check your network and try again.',
        );
      }
      throw err;
    }

    if (res.status === 404) {
      throw new Error(`Claude plugin "${id}" not found`);
    }
    if (!res.ok) {
      throw new Error(`Claude plugins view failed: ${res.status}`);
    }

    const html = await res.text();
    const detail = parseDetail(id, html);

    // Fetch the listing card (for verified status, install count, and
    // the full works-with list which the detail page sometimes drops)
    // and the marketplace manifest (for source coords) in parallel.
    // Both are cached so this is a no-op after the first call.
    const [card, marketplace] = await Promise.all([
      loadListing()
        .then((c) => c.byId.get(id))
        .catch(() => undefined),
      loadMarketplace().catch(() => null),
    ]);

    const worksWith = unique([
      ...(card?.worksWith ?? []),
      ...detail.worksWith,
      ...(detail.installRuntime ? [detail.installRuntime] : []),
    ]);
    const merged: PluginDetail = {
      ...detail,
      worksWith,
      verified: detail.verified || card?.verified === true,
    };

    // Resolve the GitHub source through marketplace.json. Lookup key is
    // the plugin name from the install command (which is authoritative
    // for the marketplace name); fall back to the slug if we couldn't
    // parse the install command.
    const lookupName = merged.pluginName ?? id;
    const resolved = resolvePluginSource(lookupName, marketplace ?? null);

    const summary: RegistryItemSummary = {
      id: merged.id,
      capability: 'plugins',
      title: merged.title,
      description:
        card?.description ??
        (merged.description
          ? truncate(merged.description, SUMMARY_PREVIEW_CHARS)
          : undefined),
      tags: buildTagsForView(merged, card, worksWith, resolved),
      homepage: homepageFor(id),
    };

    return {
      ...summary,
      preview: buildPreview(merged, card, resolved),
      installSnippet: buildInstallSnippet(merged, resolved),
    };
  },
};

function cardMatches(card: ListingCard, q: string): boolean {
  if (card.id.toLowerCase().includes(q)) return true;
  if (card.title.toLowerCase().includes(q)) return true;
  if (card.description && card.description.toLowerCase().includes(q)) return true;
  for (const w of card.worksWith) {
    if (w.toLowerCase().includes(q)) return true;
  }
  if (card.verified && 'anthropic verified'.includes(q)) return true;
  return false;
}

export default adapter;
