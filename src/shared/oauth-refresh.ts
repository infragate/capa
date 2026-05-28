/**
 * Shared OAuth refresh-failure classifier.
 *
 * A refresh call can fail for many reasons. Most of them are transient
 * (network blip, proxy 5xx, rate limit, DNS hiccup, laptop sleep/resume)
 * and the stored refresh_token is still good — retrying later will succeed.
 *
 * Only a small set of failures indicate the refresh_token itself is no
 * longer usable and the user must re-authenticate:
 *   - HTTP 400 / 401 / 403, AND
 *   - The response body mentions `invalid_grant`, `invalid_token`, or
 *     `expired` (per RFC 6749 §5.2 + common provider conventions).
 *
 * Anything else (5xx, timeouts, thrown errors) is treated as transient so
 * we don't delete a perfectly valid stored token on a temporary outage.
 */
const PERMANENT_REFRESH_FAILURE_MARKERS = ['invalid_grant', 'invalid_token', 'expired'];

export function isPermanentRefreshFailure(
  error?: unknown,
  response?: Response,
  responseBody?: string,
): boolean {
  if (response) {
    const status = response.status;
    if (status === 400 || status === 401 || status === 403) {
      const body = (responseBody ?? '').toLowerCase();
      return PERMANENT_REFRESH_FAILURE_MARKERS.some((marker) => body.includes(marker));
    }
    return false;
  }
  return false;
}
