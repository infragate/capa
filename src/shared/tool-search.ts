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

/** Lowercase words, splitting on anything that is not a letter or digit. */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
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
 * terms outranks one that matches a single term repeatedly, which is what
 * makes a two-word query behave like the AND a person expects.
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
	const terms = [...new Set(tokenize(query))];

	if (terms.length === 0) {
		return [...tools]
			.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName))
			.slice(0, capped)
			.map((tool) => ({ tool, score: 0, matchedTerms: 0 }));
	}

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
		hits.push({ tool, score: score + matchedTerms * 3, matchedTerms });
	}

	hits.sort(
		(a, b) =>
			b.score - a.score ||
			a.tool.qualifiedName.localeCompare(b.tool.qualifiedName),
	);
	return hits.slice(0, capped);
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
