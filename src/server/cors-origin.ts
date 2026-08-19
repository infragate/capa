function stripIpv6Brackets(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]")
		? hostname.slice(1, -1)
		: hostname;
}

export function serverHttpOrigin(bindHost: string, bindPort: number): string {
	const host =
		bindHost.includes(":") && !bindHost.startsWith("[")
			? `[${bindHost}]`
			: bindHost;
	return `http://${host}:${bindPort}`;
}

/**
 * MCP Origin gate. Default allow-list is only the server's own origin.
 * Extra origins must be listed exactly in CAPA_ALLOWED_ORIGINS.
 */
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

	if (origin === serverHttpOrigin(bindHost, bindPort)) {
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
