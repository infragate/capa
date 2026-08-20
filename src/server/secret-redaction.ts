import type { SecretValue } from "../shared/secret-value";
import { isSecretValueObject } from "../shared/secret-value";

const SENSITIVE_HEADER =
	/^(authorization|proxy-authorization)$|token|api-?key|secret|password|bearer/i;

function asSecretValueMap(
	value: unknown,
): Record<string, SecretValue> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, SecretValue> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw === "string" || isSecretValueObject(raw)) {
			out[key] = raw;
		}
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
	env?: Record<string, SecretValue> | null;
	headers?: Record<string, SecretValue> | null;
	oauth2?: {
		clientId?: string | null;
		clientSecret?: string | null;
		[key: string]: unknown;
	} | null;
	[key: string]: unknown;
}

export function redactServerForApi<T extends ApiServerSecrets>(server: T): T {
	let env = server.env;
	if (env) {
		const next: Record<string, SecretValue> = {};
		for (const [key, value] of Object.entries(env)) {
			// Keep external source pointers; blank only literal secret strings.
			next[key] = isSecretValueObject(value) ? value : "";
		}
		env = next;
	}

	let headers = server.headers;
	if (headers) {
		const next: Record<string, SecretValue> = {};
		for (const [key, value] of Object.entries(headers)) {
			if (isSecretValueObject(value)) {
				next[key] = value;
				continue;
			}
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
		const prevEnv = asSecretValueMap(prev.env);
		const nextEnv = asSecretValueMap(incoming.env);
		const env: Record<string, SecretValue> = {};
		for (const [key, value] of Object.entries(nextEnv)) {
			env[key] =
				value === "" && key in prevEnv ? prevEnv[key] : value;
		}
		merged.env = env;
	}

	if (incoming.headers !== undefined) {
		const prevHeaders = asSecretValueMap(prev.headers);
		const nextHeaders = asSecretValueMap(incoming.headers);
		const headers: Record<string, SecretValue> = { ...nextHeaders };
		for (const [key, value] of Object.entries(prevHeaders)) {
			if (key in nextHeaders) {
				if (nextHeaders[key] === "") headers[key] = value;
				continue;
			}
			if (isSensitiveHeaderName(key)) headers[key] = value;
		}
		for (const [key, value] of Object.entries(nextHeaders)) {
			if (value === "" && key in prevHeaders) {
				headers[key] = prevHeaders[key];
			}
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
