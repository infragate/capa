export function isAllowedOrigin(origin: string | null): {
	allowed: boolean;
	origin?: string;
} {
	if (!origin) {
		return { allowed: false };
	}

	try {
		const parsed = new URL(origin);
		if (
			parsed.protocol === "http:" &&
			(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
		) {
			return { allowed: true, origin };
		}
	} catch {
		// fall through to env allow-list
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
