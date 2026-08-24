/**
 * Shared OAuth refresh-failure classifier.
 *
 * A refresh call can fail for many reasons. Most of them are transient
 * (network blip, proxy 5xx, rate limit, DNS hiccup, laptop sleep/resume)
 * and the stored refresh_token is still good — retrying later will succeed.
 *
 * Tokens are only treated as permanently invalid when the token endpoint
 * returns a clear HTTP 403. Other 4xx responses (including 400/401 with
 * `invalid_grant`) and all network/5xx failures are treated as transient so
 * we never wipe stored credentials on an ambiguous failure.
 */
export function isPermanentRefreshFailure(
	error?: unknown,
	response?: Response,
	_responseBody?: string,
): boolean {
	if (response) {
		return response.status === 403;
	}
	return false;
}
