/**
 * Shared OAuth refresh-failure classifier.
 *
 * A refresh call can fail for many reasons. Most of them are transient
 * (network blip, proxy 5xx, rate limit, DNS hiccup, laptop sleep/resume)
 * and the stored refresh_token is still good — retrying later will succeed.
 *
 * Tokens are deleted only when the authorization server explicitly says the
 * credential is dead or expired (RFC 6749 §5.2 + common provider conventions):
 *   - HTTP 200 / 400 / 401 / 403 (not 5xx), AND
 *   - The response body mentions a permanent marker such as `invalid_grant`,
 *     `invalid_token`, `invalid_refresh`, `expired`, or `revoked`.
 *
 * Bare status codes without those markers (and all network/thrown errors) are
 * treated as transient so we never wipe credentials prematurely.
 */
const PERMANENT_REFRESH_FAILURE_MARKERS = [
	"invalid_grant",
	"invalid_token",
	"invalid_refresh",
	"expired",
	"revoked",
];

export function isPermanentRefreshFailure(
	error?: unknown,
	response?: Response,
	responseBody?: string,
): boolean {
	if (!response) {
		// Network / thrown errors: keep the token.
		return false;
	}
	const status = response.status;
	// Never wipe on 5xx — even if the body text looks fatal.
	if (status >= 500) return false;
	if (status !== 200 && status !== 400 && status !== 401 && status !== 403) {
		return false;
	}
	const body = (responseBody ?? "").toLowerCase();
	return PERMANENT_REFRESH_FAILURE_MARKERS.some((marker) =>
		body.includes(marker),
	);
}
