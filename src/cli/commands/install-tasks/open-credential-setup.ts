import type { Task } from '../../ui';
import { isInteractive } from '../../ui';
import type { InstallCtx } from './context';
import { openBrowser } from '../../utils/browser';
import { browserLaunchBlockedReason } from '../../utils/environment';

export function openCredentialSetupTask(opts?: { skipOpen?: boolean }): Task<InstallCtx> {
  return {
    title: 'Opening credential setup',
    enabled: (ctx) => {
      const result = ctx.configureResult as any;
      return !!(result?.needsCredentials && result?.credentialsUrl);
    },
    task: async (ctx, task) => {
      const result = ctx.configureResult as any;
      const hasVariables = result.missingVariables && result.missingVariables.length > 0;
      const hasOAuth2 = result.oauth2Servers && result.oauth2Servers.length > 0;
      const needsOAuth2Connection = hasOAuth2 && result.oauth2Servers.some((s: any) => !s.isConnected);

      // Deferred to ctx.warnings so they print after the spinner clears.
      if (hasVariables) {
        ctx.warnings.push(`Missing variables: ${result.missingVariables.join(', ')}`);
      }
      if (needsOAuth2Connection) {
        const disconnectedServers = result.oauth2Servers.filter((s: any) => !s.isConnected);
        ctx.warnings.push(
          `OAuth2 servers need connection: ${disconnectedServers
            .map((s: any) => s.serverId)
            .join(', ')}`,
        );
      }

      // Explicit caller opt-out (e.g. wrap live re-apply).
      if (opts?.skipOpen) {
        ctx.warnings.push(`Credentials needed — open: ${result.credentialsUrl}`);
        task.output = 'skipped browser open';
        return;
      }

      // CAPA was built for a local desktop. In CI / cloud agent sandboxes (or
      // any headless, non-interactive shell) there is no user at a browser, so
      // launching one is pointless and - because the opener can stay attached
      // to the browser it spawns - risks blocking the whole install. Surface
      // the URL for the user to open elsewhere instead of attempting a launch.
      const blockedReason = browserLaunchBlockedReason();
      if (!isInteractive() || blockedReason) {
        const reason = blockedReason ?? 'the shell is non-interactive';
        ctx.warnings.push(
          `Skipping browser launch (${reason}). Complete credential setup at: ${result.credentialsUrl}`,
        );
        task.output = 'skipped browser open';
        return;
      }

      task.output = 'opening browser';
      const opened = await openBrowser(result.credentialsUrl);
      if (!opened) {
        ctx.warnings.push(
          `Could not open browser automatically. Open manually: ${result.credentialsUrl}`,
        );
      }
    },
  };
}
