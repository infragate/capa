/**
 * HTML+JS bridge for cloud-OAuth GET callbacks.
 *
 * The capa cloud OAuth proxy completes the GitHub/GitLab dance server-side, then
 * redirects the user's browser back to capa's local callback URL with the resulting
 * `access_token` (and friends) in the query string — the protocol contract the
 * cloud provider uses for native loopback clients (RFC 8252).
 *
 * The local server accepts tokens only via POST + JSON body so they never land in
 * access logs or browser history. This bridge serves a tiny HTML page on the GET
 * callback that:
 *   1. Reads the tokens from `window.location.search` (never echoed by the server).
 *   2. Calls `history.replaceState` to strip them from the URL bar and the current
 *      history entry — keeps tokens out of the browser's persisted history.
 *   3. POSTs the tokens (as JSON) to the same callback path.
 *   4. Redirects to `/ui/integrations?success=<platform>` (or `?error=...`).
 *
 * Module-level pure function so it's trivially unit-testable and doesn't pull
 * `CapaServer` into the test graph.
 */
import { injectHtmlAuthToken } from "./api-guards";
import { getSpaAuthToken } from "./auth-middleware";
import { htmlSecurityHeaders } from "./html-security-headers";

export type GitOAuthPlatform = "github" | "gitlab";

/**
 * Cloud OAuth redirects back to our callback with `?state=…&flowId=…` already in
 * the redirect URL, then append tokens with a second `?` instead of `&`:
 *   …/callback?state=x&flowId=y?access_token=z
 * URLSearchParams treats `access_token` as part of `flowId`. Coerce inner `?` → `&`.
 */
export function normalizeOAuthCallbackQuery(search: string): string {
	if (!search || search === "?") return "";
	const raw = search.startsWith("?") ? search.slice(1) : search;
	return raw.replace(/\?/g, "&");
}

export function parseOAuthCallbackSearchParams(search: string): URLSearchParams {
	return new URLSearchParams(normalizeOAuthCallbackQuery(search));
}

/** True when the cloud OAuth redirect should render the HTML bridge (query and/or hash tokens). */
export function gitOAuthCallbackNeedsBridge(url: URL): boolean {
	const params = parseOAuthCallbackSearchParams(url.search);
	if (
		params.has("access_token") ||
		params.has("refresh_token") ||
		params.has("token")
	) {
		return true;
	}
	// Cloud may return tokens in the fragment (#access_token=...) which never hits the
	// server — still serve the bridge when state/flowId prove this is our callback.
	return (
		params.has("state") ||
		params.has("flowId") ||
		params.has("flow_id")
	);
}

export function buildOAuthBridgeHtml(platform: GitOAuthPlatform): string {
	const callbackPath = `/api/integrations/${platform}/oauth/callback`;
	const uiPath = "/ui/integrations";
	const displayName = platform === "github" ? "GitHub" : "GitLab";
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Connecting ${displayName}...</title>
<meta name="referrer" content="no-referrer">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0b0e14; color: #d6deeb; display: flex; align-items: center;
    justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; }
  .spinner { border: 3px solid #1f2937; border-top-color: #60a5fa; border-radius: 50%;
    width: 32px; height: 32px; margin: 0 auto 16px; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="card">
  <div class="spinner"></div>
  <p>Finishing ${displayName} sign-in&hellip;</p>
</div>
<script>
(async () => {
  var qs = window.location.search.slice(1).replace(/\\?/g, '&');
  var params = new URLSearchParams(qs);
  var hashRaw = window.location.hash;
  var hashParams = new URLSearchParams(hashRaw && hashRaw.charAt(0) === '#' ? hashRaw.slice(1) : hashRaw);
  function pick(name, alt) {
    var v = params.get(name);
    if (v) return v;
    if (alt) { v = params.get(alt); if (v) return v; }
    v = hashParams.get(name);
    if (v) return v;
    return alt ? hashParams.get(alt) : null;
  }
  var accessToken = pick('access_token', 'token');
  var refreshToken = pick('refresh_token');
  var expiresInRaw = pick('expires_in');
  var oauthError = pick('error');
  var state = pick('state');
  var flowId = pick('flowId', 'flow_id');
  try {
    history.replaceState(null, '', window.location.pathname);
  } catch (_) {}
  function go(qs) { window.location.replace(${JSON.stringify(uiPath)} + qs); }
  if (oauthError) { go('?error=' + encodeURIComponent(oauthError)); return; }
  if (!accessToken) { go('?error=' + encodeURIComponent('missing_access_token')); return; }
  try {
    var body = { access_token: accessToken };
    if (refreshToken) body.refresh_token = refreshToken;
    if (expiresInRaw) body.expires_in = parseInt(expiresInRaw, 10);
    if (state) body.state = state;
    if (flowId) body.flowId = flowId;
    var headers = { 'Content-Type': 'application/json' };
    if (window.__CAPA_AUTH_TOKEN__) headers['Authorization'] = 'Bearer ' + window.__CAPA_AUTH_TOKEN__;
    var resp = await fetch(${JSON.stringify(callbackPath)}, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400) || resp.ok) {
      go('?success=${platform}');
      return;
    }
    var msg = 'callback_failed';
    try {
      var data = await resp.json();
      if (data && data.error) msg = String(data.error);
    } catch (_) {}
    go('?error=' + encodeURIComponent(msg));
  } catch (err) {
    go('?error=' + encodeURIComponent((err && err.message) || 'network_error'));
  }
})();
</script>
</body>
</html>`;
}

export function oauthBridgeResponse(platform: GitOAuthPlatform): Response {
	const html = injectHtmlAuthToken(buildOAuthBridgeHtml(platform), getSpaAuthToken());
	return new Response(html, {
		status: 200,
		headers: htmlSecurityHeaders({
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
		}),
	});
}
