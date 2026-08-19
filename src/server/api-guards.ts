import { requireAuth, isLoopbackHost } from "./auth-middleware";

export type GuardResult =
	| { ok: true }
	| { ok: false; reason: string; status: number };

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function serverHttpOrigin(host: string, port: number): string {
	const wrapped =
		host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	return `http://${wrapped}:${port}`;
}

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

function defaultPort(protocol: string, explicit: string): string {
	if (explicit) return explicit;
	return protocol === "https:" ? "443" : "80";
}

/** Browsers treat localhost and 127.0.0.1 as different Origins; both are loopback. */
export function isEquivalentApiOrigin(
	origin: string,
	serverOrigin: string,
): boolean {
	if (origin === serverOrigin) return true;
	try {
		const a = new URL(origin);
		const b = new URL(serverOrigin);
		if (a.protocol !== b.protocol) return false;
		if (
			defaultPort(a.protocol, a.port) !== defaultPort(b.protocol, b.port)
		) {
			return false;
		}
		const aHost = a.hostname.replace(/^\[|\]$/g, "");
		const bHost = b.hostname.replace(/^\[|\]$/g, "");
		return isLoopbackHost(aHost) && isLoopbackHost(bHost);
	} catch {
		return false;
	}
}

export function requireApiCsrf(
	req: Request,
	serverOrigin: string,
): GuardResult {
	if (!isMutating(req.method)) {
		return { ok: true };
	}
	if (req.headers.get("Sec-Fetch-Site") === "cross-site") {
		return { ok: false, reason: "Forbidden", status: 403 };
	}
	const origin = req.headers.get("Origin");
	if (origin && !isEquivalentApiOrigin(origin, serverOrigin)) {
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
	const csrf = requireApiCsrf(req, serverHttpOrigin(bind.host, bind.port));
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
