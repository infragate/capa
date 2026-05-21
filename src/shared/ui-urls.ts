/**
 * Web UI route helpers for the capa server SPA.
 */

export const CAPA_DOCS_URL = 'https://capa.infragate.ai';
export const CAPA_CLOUD_OAUTH_URL = 'https://capa.infragate.ai/auth';

/** Relative path to a project's detail page (credentials, OAuth, variables). */
export function projectUiPath(projectId: string, query?: Record<string, string>): string {
  const q = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (key === 'id') continue;
      q.set(key, value);
    }
  }
  q.set('id', projectId);
  return `/ui/project?${q.toString()}`;
}

/** Absolute URL to a project's detail page. */
export function projectUiUrl(origin: string, projectId: string, query?: Record<string, string>): string {
  const base = origin.replace(/\/$/, '');
  return `${base}${projectUiPath(projectId, query)}`;
}
