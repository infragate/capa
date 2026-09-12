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

function isClearedOauthField(value: unknown): boolean {
	return value === "" || value === null;
}

/** Drop canonical + alias endpoint keys when the patch explicitly clears them. */
function clearEmptyOAuthEndpoint(
	oauth2: Record<string, unknown>,
	incoming: Record<string, unknown>,
	canonical: string,
	aliases: string[],
): void {
	if (!(canonical in incoming) || !isClearedOauthField(incoming[canonical])) {
		return;
	}
	delete oauth2[canonical];
	for (const alias of aliases) delete oauth2[alias];
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
	if (incoming.oauth2 === null) {
		delete merged.oauth2;
	} else if (nextOauth) {
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
		clearEmptyOAuthEndpoint(oauth2, nextOauth, "authorizationEndpoint", [
			"authorizationUrl",
			"authorization_endpoint",
			"authorization_url",
		]);
		clearEmptyOAuthEndpoint(oauth2, nextOauth, "tokenEndpoint", [
			"tokenUrl",
			"token_endpoint",
			"token_url",
		]);
		merged.oauth2 = oauth2;
	}

	return merged;
}

/**
 * Credential-looking `key: value` pairs a server might echo back in an error
 * body. Only the value is masked, so the message still says what went wrong.
 */
const CREDENTIAL_PAIR =
	/\b(authorization|proxy-authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|pwd)\b["']?\s*[:=]\s*["']?([^\s"',;}\]]{4,})/gi;

/** `Bearer <token>` / `Basic <token>` carry the value with no separator. */
const AUTH_SCHEME_VALUE = /\b(bearer|basic)\s+([^\s"',;}\]]+)/gi;

/**
 * Client-safe one-liner for a transport error. Values capa knows are secret
 * are removed outright; anything else that reads like a credential is masked,
 * because a non-2xx body can echo the request headers straight back.
 */
export function redactErrorDetail(
	message: string,
	knownSecrets: Iterable<string> = [],
): string {
	let out = message;
	for (const secret of knownSecrets) {
		// Short values produce noisy false positives and are not worth hiding.
		if (secret.length >= 6) out = out.split(secret).join("***");
	}
	return out
		.replace(CREDENTIAL_PAIR, (_match, label: string) => `${label}: ***`)
		.replace(AUTH_SCHEME_VALUE, (_match, scheme: string) => `${scheme} ***`)
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
}

/**
 * Resolved secret values carried by a server def — sensitive headers and every
 * env value. Used to scrub them out of error text before it reaches a client.
 */
export function resolvedSecretValues(def: {
	headers?: Record<string, unknown>;
	env?: Record<string, unknown>;
}): string[] {
	const values: string[] = [];
	for (const [name, value] of Object.entries(def.headers ?? {})) {
		if (typeof value === "string" && isSensitiveHeaderName(name)) {
			values.push(value);
		}
	}
	for (const value of Object.values(def.env ?? {})) {
		if (typeof value === "string") values.push(value);
	}
	return values;
}
