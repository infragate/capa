import type { Task } from '../../ui';
import { applyInstructionContextConfig } from '../../utils/instruction-context-config';
import type { InstallCtx } from './context';
import { materialInstallProviders } from './helpers/install-providers';

/**
 * Point providers with a configurable instruction-file setting (Gemini CLI
 * `context.fileName`) at the file capa writes for them. Runs before the
 * lockfile is written so capa-owned values are recorded in the same install.
 */
export function configureInstructionContextTask(): Task<InstallCtx> {
  return {
    title: 'Configuring instruction files',
    enabled: (ctx) =>
      materialInstallProviders(ctx).length > 0 ||
      ctx.lockBuilder.getProviderConfig().length > 0,
    task: async (ctx) => {
      try {
        const { owned, warnings } = applyInstructionContextConfig(
          ctx.projectPath,
          materialInstallProviders(ctx),
          ctx.lockBuilder.getProviderConfig(),
        );
        ctx.lockBuilder.setProviderConfig(owned);
        ctx.warnings.push(...warnings);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.warnings.push(`Failed to configure instruction files: ${message}`);
      }
    },
  };
}
