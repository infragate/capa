import { checkRequiredCommand } from './install-tasks/helpers/required-command';

/**
 * Ensure the wrap launch binary is on PATH before preparing a shadow workspace.
 */
export async function ensureWrapBinaryOnPath(
  binary: string,
  providerArg: string,
): Promise<void> {
  await checkRequiredCommand({
    cli: binary,
    description: `required by capa wrap ${providerArg}`,
  });
}
