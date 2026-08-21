function stripIpv6Brackets(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]")
		? hostname.slice(1, -1)
		: hostname;
}

function normalizeHostname(host: string): string {
	return stripIpv6Brackets(host).toLowerCase();
}

function parseHostHeader(
	header: string,
): { hostname: string; port: string | null } | null {
	const trimmed = header.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("[")) {
		const end = trimmed.indexOf("]");
		if (end === -1) return null;
		const hostname = trimmed.slice(1, end);
		const rest = trimmed.slice(end + 1);
		const port = rest.startsWith(":") ? rest.slice(1) : null;
		return { hostname, port };
	}
	const colon = trimmed.lastIndexOf(":");
	if (colon === -1) {
		return { hostname: trimmed, port: null };
	}
	return {
		hostname: trimmed.slice(0, colon),
		port: trimmed.slice(colon + 1),
	};
}

function isLoopbackHostname(hostname: string): boolean {
	const h = normalizeHostname(hostname);
	return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

function resolveHostPort(port: string | null): number | null {
	if (port === null) return 80;
	if (!/^\d+$/.test(port)) return null;
	return Number(port);
}

/**
 * DNS-rebinding defence: only loopback names and the configured bind host,
 * on the bind port, are accepted. Request Host is never used to build
 * redirects or cookies.
 */
export function isAllowedHostHeader(
	hostHeader: string | null,
	bindHost: string,
	bindPort: number,
): boolean {
	if (!hostHeader) return false;
	const parsed = parseHostHeader(hostHeader);
	if (!parsed) return false;
	const port = resolveHostPort(parsed.port);
	if (port === null || port !== bindPort) return false;
	const hostname = normalizeHostname(parsed.hostname);
	if (isLoopbackHostname(hostname)) return true;
	return hostname === normalizeHostname(bindHost);
}

export function misdirectedHostResponse(
	request: Request,
	bindHost: string,
	bindPort: number,
): Response | null {
	const host = request.headers.get("host");
	if (isAllowedHostHeader(host, bindHost, bindPort)) return null;
	return new Response("Misdirected Request", { status: 421 });
}

export async function withAllowedHost(
	request: Request,
	bindHost: string,
	bindPort: number,
	next: () => Promise<Response> | Response,
): Promise<Response> {
	const blocked = misdirectedHostResponse(request, bindHost, bindPort);
	if (blocked) return blocked;
	return next();
}
