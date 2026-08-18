/**
 * Web UI route helpers for the capa server SPA.
 */

export const CAPA_DOCS_URL = "https://capa.infragate.ai/getting-started/introduction/";
export const CAPA_CLOUD_OAUTH_URL = "https://capa.infragate.ai/auth";

/** Shown before browser OAuth. Cloud host is pinned; not request-controlled. */
export function cloudOAuthDisclosure(): string {
	return (
		"Browser OAuth sends GitHub/GitLab access and refresh tokens through " +
		`${CAPA_CLOUD_OAUTH_URL}. Prefer a short-lived PAT via ` +
		"`capa auth <provider> --access-token` so tokens stay on this machine."
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
