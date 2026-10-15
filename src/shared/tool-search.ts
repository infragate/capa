import type { Capabilities } from "../types/capabilities";
import { getQualifiedToolName } from "../types/capabilities";

/**
 * Term-based tool search. No embeddings, no index — a project has tens to low
 * hundreds of tools, so scoring every one against the query is cheaper than
 * anything it could be replaced with.
 */

/** The text of one tool that a query can match against. */
export interface SearchableTool {
	/** Name the agent calls: `server.tool` / `group.tool` / `tool`. */
	qualifiedName: string;
	/** Local id. */
	id: string;
	/** Remote MCP tool name, when it differs from the id. */
	remoteName?: string;
	/** Server id for MCP tools, group for grouped command tools. */
	context?: string;
	description?: string;
}

export interface ToolSearchHit {
	tool: SearchableTool;
	score: number;
	/** How many distinct query terms this tool matched. */
	matchedTerms: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Words a query contributes nothing by matching. Ranking counts how many of
 * the query's terms a tool matched, so "open a pull request" must not reward a
 * tool whose description happens to contain "a".
 */
const STOPWORDS = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"of",
	"for",
	"to",
	"in",
	"on",
	"at",
	"by",
	"with",
	"from",
	"into",
	"is",
	"are",
	"be",
	"do",
	"does",
	"it",
	"its",
	"this",
	"that",
	"my",
	"me",
	"i",
	"we",
	"you",
	"how",
	"what",
	"can",
	"should",
	"want",
	"need",
	"using",
	"use",
	"please",
]);

/**
 * Lowercase words, splitting on anything that is not a letter or digit in any
 * script — an all-non-ASCII query must produce terms, not look empty.
 */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/** Query terms worth scoring: tokenized, de-duplicated, stopwords removed. */
export function queryTerms(query: string): string[] {
	const terms = [...new Set(tokenize(query))];
	const meaningful = terms.filter((t) => !STOPWORDS.has(t));
	// An all-stopword query ("how do I") still beats listing everything.
	return meaningful.length > 0 ? meaningful : terms;
}

/** Shared-prefix length needed to treat two different words as the same one. */
const STEM_PREFIX = 5;

/**
 * True when a token and a query term are close enough to count as a match:
 * equal, one contains the other ("issue" vs "issues", "repo" vs "repository"),
 * or they share a long prefix ("repository" vs "repositories").
 *
 * ponytail: prefix length stands in for a stemmer — it also matches
 * "container"/"contains", which is tolerable in a ranked list. Swap in a real
 * stemmer if the noise ever shows up in results people complain about.
 */
function tokenMatches(token: string, term: string): boolean {
	if (token === term) return true;
	if (term.length >= 3 && token.includes(term)) return true;
	if (token.length >= 3 && term.includes(token)) return true;
	if (token.length >= STEM_PREFIX && term.length >= STEM_PREFIX) {
		let shared = 0;
		while (
			shared < token.length &&
			shared < term.length &&
			token[shared] === term[shared]
		) {
			shared++;
		}
		if (shared >= STEM_PREFIX) return true;
	}
	return false;
}

/** Score one tool against one query term. 0 means the term did not match. */
function scoreTerm(tool: SearchableTool, term: string): number {
	const id = tool.id.toLowerCase();
	const qualified = tool.qualifiedName.toLowerCase();
	if (id === term || qualified === term) return 12;

	const nameTokens = tokenize(
		`${tool.id} ${tool.remoteName ?? ""} ${tool.qualifiedName}`,
	);
	if (nameTokens.some((t) => t === term)) return 6;
	if (nameTokens.some((t) => tokenMatches(t, term))) return 4;

	const descriptionTokens = tokenize(tool.description ?? "");
	if (descriptionTokens.some((t) => t === term)) return 2;
	if (descriptionTokens.some((t) => tokenMatches(t, term))) return 1;

	const contextTokens = tokenize(tool.context ?? "");
	if (contextTokens.some((t) => tokenMatches(t, term))) return 1;

	return 0;
}

/**
 * Tools matching `query`, best first. A tool that matches more of the query's
 * terms outranks one matching fewer of them however strongly, which is what
 * makes a multi-word query behave like the AND a person expects.
 *
 * An empty query lists the first `limit` tools alphabetically — "what is
 * there?" is a reasonable thing to ask a search tool.
 */
export function searchTools(
	tools: SearchableTool[],
	query: string,
	limit: number = DEFAULT_LIMIT,
): ToolSearchHit[] {
	const capped = Math.min(
		Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1),
		MAX_LIMIT,
	);
	const terms = queryTerms(query);

	if (terms.length === 0) {
		return [...tools]
			.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName))
			.slice(0, capped)
			.map((tool) => ({ tool, score: 0, matchedTerms: 0 }));
	}

	// Searching a tool's exact name (as a description or another tool named
	// it) must put that tool first, not rank it among every tool sharing a word.
	const exact = new Set(exactNameMatches(tools, query));
	const hits: ToolSearchHit[] = [];
	for (const tool of tools) {
		let score = 0;
		let matchedTerms = 0;
		for (const term of terms) {
			const termScore = scoreTerm(tool, term);
			if (termScore > 0) {
				score += termScore;
				matchedTerms++;
			}
		}
		if (matchedTerms === 0) continue;
		hits.push({ tool, score, matchedTerms });
	}

	// Coverage first: a tool matching two of the query's words beats one that
	// matches a single word strongly, however heavy that single match scores.
	// Field weights only break ties within the same coverage.
	hits.sort(
		(a, b) =>
			Number(exact.has(b.tool)) - Number(exact.has(a.tool)) ||
			b.matchedTerms - a.matchedTerms ||
			b.score - a.score ||
			a.tool.qualifiedName.localeCompare(b.tool.qualifiedName),
	);
	return hits.slice(0, capped);
}

/** Lowercase, with `.`/`-` treated like `_` (`github.get_issue` = `github_get_issue`). */
function normalizeName(name: string): string {
	return name.trim().toLowerCase().replace(/[.-]/g, "_");
}

/** True when a query reads as a tool name (`get_issue`, `github.get_issue`). */
export function isToolNameQuery(query: string): boolean {
	const q = query.trim();
	return /^[\p{L}\p{N}_.-]+$/u.test(q) && /[_.-]/.test(q);
}

/**
 * Tools whose qualified name, local id or remote name is exactly `name`. A
 * bare remote name (`get_issue`, as a server's own descriptions call it)
 * finds the qualified tool (`github.get_issue`).
 */
export function exactNameMatches(
	tools: SearchableTool[],
	name: string,
): SearchableTool[] {
	const wanted = normalizeName(name);
	if (!wanted) return [];
	return tools.filter((t) =>
		[t.qualifiedName, t.id, t.remoteName].some(
			(n) => n !== undefined && normalizeName(n) === wanted,
		),
	);
}

/** Up to `limit` qualified names to suggest for a tool name that isn't there. */
export function suggestToolNames(
	tools: SearchableTool[],
	name: string,
	limit = 3,
): string[] {
	const names = [
		...exactNameMatches(tools, name),
		...searchTools(tools, name, limit).map((h) => h.tool),
	].map((t) => t.qualifiedName);
	return [...new Set(names)].slice(0, limit);
}

/** The project's tools in the shape `searchTools` scores. */
export function searchableTools(capabilities: Capabilities): SearchableTool[] {
	return (capabilities.tools ?? []).map((tool) => ({
		qualifiedName: getQualifiedToolName(tool),
		id: tool.id,
		remoteName: tool.type === "mcp" ? tool.def.tool : undefined,
		context:
			tool.type === "mcp"
				? tool.def.server.replace(/^@/, "")
				: (tool.group ?? undefined),
		description: tool.description,
	}));
}
