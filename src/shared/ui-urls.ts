/**
 * Web UI route helpers for the capa server SPA.
 */

export const CAPA_DOCS_URL = "https://capa.infragate.ai/getting-started/introduction/";
export const CAPA_CLOUD_OAUTH_URL = "https://capa.infragate.ai/auth";

/** Shown before browser OAuth. Cloud host is pinned; not request-controlled. */
export function cloudOAuthDisclosure(): string {
	return (
		"Prefer `gh auth login` or Git Credential Manager so CAPA never stores a git token. " +
		"Browser OAuth still sends GitHub/GitLab tokens through " +
		`${CAPA_CLOUD_OAUTH_URL}. A PAT via \`capa auth <provider> --access-token\` ` +
		"is handed to your git credential helper, not capa.db."
	);
}

/** Relative path to a project's detail page (credentials, OAuth, variables). */
export function projectUiPath(
	projectId: string,
	query?: Record<string, string>,
): string {
	const q = new URLSearchParams();
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (key === "id") continue;
			q.set(key, value);
		}
	}
	q.set("id", projectId);
	return `/ui/project?${q.toString()}`;
}

/** Absolute URL to a project's detail page. */
export function projectUiUrl(
	origin: string,
	projectId: string,
	query?: Record<string, string>,
): string {
	const base = origin.replace(/\/$/, "");
	return `${base}${projectUiPath(projectId, query)}`;
}
