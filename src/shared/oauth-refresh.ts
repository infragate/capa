/**
 * Shared OAuth refresh-failure classifier.
 *
 * A refresh call can fail for many reasons. Most of them are transient
 * (network blip, proxy 5xx, rate limit, DNS hiccup, laptop sleep/resume)
 * and the stored refresh_token is still good — retrying later will succeed.
 *
 * Only a small set of failures indicate the refresh_token itself is no
 * longer usable and the user must re-authenticate:
 *   - HTTP 401 / 403 on the token endpoint (typical for revoked refresh tokens)
 *   - HTTP 400 whose body mentions RFC 6749 error codes (invalid_grant, …)
 *   - Corrupt / undecryptable stored tokens (master key rotation, AAD mismatch)
 *
 * 5xx, rate limits, and network errors stay transient so we don't delete good
 * tokens on a temporary outage.
 */
const PERMANENT_REFRESH_FAILURE_MARKERS = [
	"invalid_grant",
	"invalid_token",
	"expired",
	"invalid_auth",
	"invalid_client",
	"unauthorized_client",
];

/** Stored-token / crypto failures — reconnect required, not a network blip. */
export function isCorruptStoredCredentialError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error);
	return (
		msg.includes("Failed to decrypt secret") ||
		msg.includes("encryptSecret requires") ||
		msg.includes('The "data" argument must be of type string') ||
		msg.includes("truncated ciphertext") ||
		msg.includes("ciphertext AAD mismatch")
	);
}

export function isPermanentRefreshFailure(
	error?: unknown,
	response?: Response,
	responseBody?: string,
): boolean {
	if (error !== undefined && isCorruptStoredCredentialError(error)) {
		return true;
	}
	if (response) {
		const status = response.status;
		// Token endpoints reject bad refresh tokens with 401/403 even when the
		// body omits RFC 6749 error codes (common for MCP vendor APIs).
		if (status === 401 || status === 403) {
			return true;
		}
		if (status === 400) {
			const body = (responseBody ?? "").toLowerCase();
			return PERMANENT_REFRESH_FAILURE_MARKERS.some((marker) =>
				body.includes(marker),
			);
		}
		return false;
	}
	return false;
}
