/**
 * Web UI route helpers for the capa server SPA.
 */

/** Relative path to a project's detail page (credentials, OAuth, variables). */
export function projectUiPath(projectId: string, query?: Record<string, string>): string {
  const q = new URLSearchParams();
  q.set('id', projectId);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      q.set(key, value);
    }
  }
  return `/ui/project?${q.toString()}`;
}

/** Absolute URL to a project's detail page. */
export function projectUiUrl(origin: string, projectId: string, query?: Record<string, string>): string {
  const base = origin.replace(/\/$/, '');
  return `${base}${projectUiPath(projectId, query)}`;
}
