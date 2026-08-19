import type { SecretValue } from "../shared/secret-ref";
import { isSecretRef } from "../shared/secret-ref";

const SENSITIVE_HEADER =
	/^(authorization|proxy-authorization)$|token|api-?key|secret|password|bearer/i;

function asEnvMap(value: unknown): Record<string, SecretValue> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, SecretValue> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw === "string") out[key] = raw;
		else if (isSecretRef(raw)) out[key] = raw;
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

function redactEnvValue(value: SecretValue): SecretValue {
	if (typeof value === "string") return "";
	return value;
}

export function redactServerForApi<T extends ApiServerSecrets>(server: T): T {
	const env = server.env
		? Object.fromEntries(
				Object.entries(server.env).map(([key, value]) => [
					key,
					redactEnvValue(value),
				]),
			)
		: server.env;

	let headers = server.headers;
	if (headers) {
		const next: Record<string, SecretValue> = {};
		for (const [key, value] of Object.entries(headers)) {
			if (typeof value !== "string") {
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

export function mergeServerDef(
	existing: Record<string, unknown> | null | undefined,
	incoming: Record<string, unknown>,
): Record<string, unknown> {
	const prev = existing ?? {};
	const merged: Record<string, unknown> = { ...prev, ...incoming };

	if (incoming.env !== undefined) {
		const prevEnv = asEnvMap(prev.env);
		const nextEnv = asEnvMap(incoming.env);
		const env: Record<string, SecretValue> = {};
		for (const [key, value] of Object.entries(nextEnv)) {
			env[key] =
				value === "" && key in prevEnv ? prevEnv[key] : value;
		}
		merged.env = env;
	}

	if (incoming.headers !== undefined) {
		const prevHeaders = asEnvMap(prev.headers);
		const nextHeaders = asEnvMap(incoming.headers);
		const headers: Record<string, SecretValue> = { ...nextHeaders };
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
