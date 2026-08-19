import type { Capabilities } from '../../../types/capabilities';
import type { InstallCtx } from './context';

export type InstallErrorMode = 'warn' | 'stop';

/** @default warn */
export function getInstallErrorMode(capabilities: Capabilities): InstallErrorMode {
  const raw = capabilities.options?.onInstallError;
  return raw === 'stop' ? 'stop' : 'warn';
}

export function shouldStopOnInstallError(ctx: InstallCtx): boolean {
  return ctx.installErrorMode === 'stop';
}

/** Record a single failure. Throws in `stop` mode. */
export function raiseInstallError(ctx: InstallCtx, message: string): void {
  ctx.failed++;
  if (shouldStopOnInstallError(ctx)) {
    throw new Error(message);
  }
  ctx.warnings.push(message);
}

/** Record a failure during a batch (e.g. per-skill). Does not throw until batch finish. */
export function recordInstallFailure(ctx: InstallCtx, message: string): void {
  ctx.failed++;
  if (shouldStopOnInstallError(ctx)) {
    ctx.errors.push(message);
  } else {
    ctx.warnings.push(message);
  }
}

/** After a batch, throw a summary in `stop` mode when anything failed in the batch. */
export function finishInstallBatch(
  ctx: InstallCtx,
  batchFailed: number,
  summaryMessage: string,
): void {
  if (batchFailed <= 0) return;
  if (shouldStopOnInstallError(ctx)) {
    throw new Error(summaryMessage);
  }
  ctx.warnings.push(summaryMessage);
}
