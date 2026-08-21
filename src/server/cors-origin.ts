/**
 * MCP Origin gate. Default allow-list covers the server's own connectable
 * origins. Bind wildcards and loopback aliases (localhost / 127.0.0.1 / ::1)
 * are treated as equivalent for the same port. Extra origins must be listed
 * exactly in CAPA_ALLOWED_ORIGINS.
 */

function stripIpv6Brackets(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]")
		? hostname.slice(1, -1)
		: hostname;
}

function isLoopbackHostname(hostname: string): boolean {
	const h = stripIpv6Brackets(hostname).toLowerCase();
	return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function isWildcardBindHost(host: string): boolean {
	const h = stripIpv6Brackets(host.trim());
	return h === "" || h === "0.0.0.0" || h === "::";
}

export function serverHttpOrigin(bindHost: string, bindPort: number): string {
	const host =
		bindHost.includes(":") && !bindHost.startsWith("[")
			? `[${bindHost}]`
			: bindHost;
	return `http://${host}:${bindPort}`;
}

/** Origins that are equivalent to accessing this server's local UI/MCP endpoint. */
function defaultServerOrigins(bindHost: string, bindPort: number): Set<string> {
	const origins = new Set<string>();
	if (isWildcardBindHost(bindHost) || isLoopbackHostname(bindHost)) {
		origins.add(`http://127.0.0.1:${bindPort}`);
		origins.add(`http://localhost:${bindPort}`);
		origins.add(`http://[::1]:${bindPort}`);
		return origins;
	}
	origins.add(serverHttpOrigin(bindHost, bindPort));
	return origins;
}

export function isAllowedOrigin(
	origin: string | null,
	bindHost: string,
	bindPort: number,
): {
	allowed: boolean;
	origin?: string;
} {
	if (!origin) {
		return { allowed: false };
	}

	if (defaultServerOrigins(bindHost, bindPort).has(origin)) {
		return { allowed: true, origin };
	}

	const extras =
		process.env.CAPA_ALLOWED_ORIGINS?.split(",")
			.map((o) => o.trim())
			.filter(Boolean) ?? [];
	if (extras.includes(origin)) {
		return { allowed: true, origin };
	}

	return { allowed: false };
}
