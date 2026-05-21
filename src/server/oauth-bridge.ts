/**
 * HTML+JS bridge for cloud-OAuth GET callbacks.
 *
 * The capa cloud OAuth proxy completes the GitHub/GitLab dance server-side, then
 * redirects the user's browser back to capa's local callback URL with the resulting
 * `access_token` (and friends) in the query string — that's the protocol contract
 * the cloud provider uses for native loopback clients (RFC 8252).
 *
 * #S3 (capa security hardening) requires the local server to accept tokens *only*
 * via POST + JSON body so they don't end up in access logs or browser history. The
 * cloud's GET redirect would otherwise be rejected with 405, breaking sign-in.
 *
 * This bridge bridges the two contracts: it serves a tiny HTML page on the GET
 * callback that:
 *   1. Reads the tokens from `window.location.search` (never echoed by the server).
 *   2. Calls `history.replaceState` to strip them from the URL bar and the current
 *      history entry — keeps tokens out of the browser's persisted history.
 *   3. POSTs the tokens (as JSON) to the same callback path — the spec-compliant
 *      ingress hardened by #S3.
 *   4. Redirects to `/ui/integrations?success=<platform>` (or `?error=...`).
 *
 * Kept as a module-level pure function so it's trivially unit-testable and doesn't
 * pull `CapaServer` into the test graph.
 */
export type GitOAuthPlatform = 'github' | 'gitlab';

export function buildOAuthBridgeHtml(platform: GitOAuthPlatform): string {
  const callbackPath = `/api/integrations/${platform}/oauth/callback`;
  const uiPath = '/ui/integrations';
  const displayName = platform === 'github' ? 'GitHub' : 'GitLab';
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
  var params = new URLSearchParams(window.location.search);
  var accessToken = params.get('access_token');
  var refreshToken = params.get('refresh_token');
  var expiresInRaw = params.get('expires_in');
  var oauthError = params.get('error');
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
    var resp = await fetch(${JSON.stringify(callbackPath)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  return new Response(buildOAuthBridgeHtml(platform), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
