const SENSITIVE_HEADER =
	/^(authorization|proxy-authorization)$|token|api-?key|secret|password|bearer/i;

function asStringMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw === "string") out[key] = raw;
	}
	return out;
}

function asObj(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

export function isSensitiveHeaderName(name: string): boolean {
	return SENSITIVE_HEADER.test(name);
}

export interface ApiServerSecrets {
	env?: Record<string, string> | null;
	headers?: Record<string, string> | null;
	oauth2?: {
		clientId?: string | null;
		clientSecret?: string | null;
		[key: string]: unknown;
	} | null;
	[key: string]: unknown;
}

export function redactServerForApi<T extends ApiServerSecrets>(server: T): T {
	const env = server.env
		? Object.fromEntries(Object.keys(server.env).map((key) => [key, ""]))
		: server.env;

	let headers = server.headers;
	if (headers) {
		const next: Record<string, string> = {};
		for (const [key, value] of Object.entries(headers)) {
			if (isSensitiveHeaderName(key)) continue;
			next[key] = value;
		}
		headers = next;
	}

	let oauth2 = server.oauth2;
	if (oauth2) {
		const { clientSecret: _omit, ...rest } = oauth2;
		oauth2 = rest;
	}

	return { ...server, env, headers, oauth2 };
}

/** Strip secrets from oauth2 blocks returned by OAuth listing APIs. */
export function redactOAuth2ConfigForApi(
	oauth2: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
	if (!oauth2) return oauth2;
	const { clientSecret: _a, client_secret: _b, ...rest } = oauth2;
	return rest;
}

export function mergeServerDef(
	existing: Record<string, unknown> | null | undefined,
	incoming: Record<string, unknown>,
): Record<string, unknown> {
	const prev = existing ?? {};
	const merged: Record<string, unknown> = { ...prev, ...incoming };

	if (incoming.env !== undefined) {
		const prevEnv = asStringMap(prev.env);
		const nextEnv = asStringMap(incoming.env);
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(nextEnv)) {
			env[key] = value === "" && key in prevEnv ? prevEnv[key] : value;
		}
		merged.env = env;
	}

	if (incoming.headers !== undefined) {
		const prevHeaders = asStringMap(prev.headers);
		const nextHeaders = asStringMap(incoming.headers);
		const headers: Record<string, string> = { ...nextHeaders };
		for (const [key, value] of Object.entries(prevHeaders)) {
			if (key in nextHeaders) {
				if (nextHeaders[key] === "") headers[key] = value;
				continue;
			}
			if (isSensitiveHeaderName(key)) headers[key] = value;
		}
		for (const [key, value] of Object.entries(nextHeaders)) {
			if (value === "" && key in prevHeaders) headers[key] = prevHeaders[key];
		}
		merged.headers = headers;
	}

	const prevOauth = asObj(prev.oauth2);
	const nextOauth = asObj(incoming.oauth2);
	if (nextOauth) {
		const oauth2: Record<string, unknown> = { ...prevOauth, ...nextOauth };
		const incomingSecret = nextOauth.clientSecret;
		if (
			(incomingSecret === undefined ||
				incomingSecret === "" ||
				incomingSecret === null) &&
			typeof prevOauth?.clientSecret === "string"
		) {
			oauth2.clientSecret = prevOauth.clientSecret;
		}
		merged.oauth2 = oauth2;
	}

	return merged;
}
