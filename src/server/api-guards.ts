import { requireAuth } from "./auth-middleware";

export type GuardResult =
	| { ok: true }
	| { ok: false; reason: string; status: number };

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isMutating(method: string): boolean {
	return MUTATING_METHODS.has(method.toUpperCase());
}

export function isPublicApiRoute(method: string, pathname: string): boolean {
	const verb = method.toUpperCase();
	if (verb === "OPTIONS") {
		return true;
	}
	if (verb !== "GET" && verb !== "HEAD" && verb !== "POST") {
		return false;
	}
	if (/^\/api\/integrations\/(github|gitlab)\/oauth\/callback$/.test(pathname)) {
		return true;
	}
	if (/^\/api\/projects\/[^/]+\/oauth\/callback$/.test(pathname)) {
		return true;
	}
	return false;
}

/**
 * No Origin match: a reverse proxy (e.g. Orca's *.orca.localhost labels) serves
 * the UI from an origin we can't predict (#300). The bearer token is the CSRF
 * defence, since browsers never attach it on their own, and withAllowedHost
 * stops DNS rebinding from reading it out of the SPA HTML.
 */
export function requireApiCsrf(req: Request): GuardResult {
	if (!isMutating(req.method)) {
		return { ok: true };
	}
	if (req.headers.get("Sec-Fetch-Site") === "cross-site") {
		return { ok: false, reason: "Forbidden", status: 403 };
	}
	return { ok: true };
}

export function requireMutatingJsonContentType(req: Request): GuardResult {
	if (!isMutating(req.method)) {
		return { ok: true };
	}
	const media = (req.headers.get("Content-Type") ?? "")
		.split(";")[0]
		.trim()
		.toLowerCase();
	if (media === "application/json" || media === "multipart/form-data") {
		return { ok: true };
	}
	return { ok: false, reason: "Unsupported Media Type", status: 415 };
}

export function authorizeApiRequest(
	req: Request,
	bind: { host: string; port: number },
): GuardResult {
	const pathname = new URL(req.url).pathname;
	if (isPublicApiRoute(req.method, pathname)) {
		return { ok: true };
	}
	const auth = requireAuth(req, bind.host);
	if (!auth.ok) {
		return auth;
	}
	const csrf = requireApiCsrf(req);
	if (!csrf.ok) {
		return csrf;
	}
	return requireMutatingJsonContentType(req);
}

export function injectHtmlAuthToken(
	html: string,
	token: string | null,
): string {
	if (!token) {
		return html;
	}
	const script = `<script>window.__CAPA_AUTH_TOKEN__=${JSON.stringify(token)};</script>`;
	const idx = html.indexOf("</head>");
	if (idx === -1) {
		return script + html;
	}
	return html.slice(0, idx) + script + html.slice(idx);
}
