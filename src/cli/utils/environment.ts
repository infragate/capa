/**
 * Detection helpers for headless / non-interactive execution contexts.
 *
 * CAPA was designed to run on a developer's desktop, where launching a browser
 * for OAuth or credential setup is expected. It is increasingly run inside CI
 * pipelines and cloud agent sandboxes (Cursor Cloud, GitHub Codespaces,
 * Gitpod, dev containers, headless SSH sessions, ...) where there is no user
 * at a browser. These helpers let interactive-only steps degrade gracefully
 * (for example, print a URL) instead of attempting - and potentially blocking
 * on - a browser launch.
 */

/**
 * Environment variables that strongly indicate CAPA is running in CI or a
 * cloud/remote agent sandbox rather than on an interactive desktop.
 */
const SANDBOX_ENV_VARS = [
  'CI',
  'CURSOR_AGENT',
  'CURSOR_CLOUD',
  'CODESPACES',
  'GITPOD_WORKSPACE_ID',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'REMOTE_CONTAINERS',
  'DEVCONTAINER',
] as const;

export function isSandboxEnvironment(): boolean {
  return SANDBOX_ENV_VARS.some((name) => Boolean(process.env[name]));
}

/**
 * Whether a graphical display is available for launching a browser. macOS and
 * Windows always provide a window server; other platforms (Linux, *BSD)
 * require an X11 (`DISPLAY`) or Wayland (`WAYLAND_DISPLAY`) session.
 */
export function hasGraphicalDisplay(): boolean {
  const platform = process.platform;
  if (platform === 'darwin' || platform === 'win32') return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/**
 * Whether the user has explicitly opted out of browser launches, following the
 * widely-used `BROWSER=none` / `NO_BROWSER` conventions plus a CAPA-specific
 * `CAPA_NO_BROWSER` override.
 */
export function isBrowserDisabledByEnv(): boolean {
  if (process.env.CAPA_NO_BROWSER || process.env.NO_BROWSER) return true;
  const browser = process.env.BROWSER?.trim().toLowerCase();
  return browser === 'none' || browser === 'false' || browser === '0';
}

/**
 * Returns a short, human-readable reason when auto-launching a browser is
 * inappropriate for the current environment, or `null` when a launch may be
 * attempted.
 */
export function browserLaunchBlockedReason(): string | null {
  if (isBrowserDisabledByEnv()) {
    return 'browser launch is disabled via environment (BROWSER/NO_BROWSER/CAPA_NO_BROWSER)';
  }
  if (isSandboxEnvironment()) {
    return 'running in a CI or cloud agent sandbox';
  }
  if (!hasGraphicalDisplay()) {
    return 'no graphical display is available';
  }
  return null;
}

/** Convenience wrapper: `true` when a browser launch may be attempted. */
export function canLaunchBrowser(): boolean {
  return browserLaunchBlockedReason() === null;
}
