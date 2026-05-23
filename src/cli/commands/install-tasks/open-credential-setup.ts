import type { Task } from '../../ui';
import type { InstallCtx } from './context';
import { openBrowser } from './helpers/browser';

export function openCredentialSetupTask(): Task<InstallCtx> {
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
