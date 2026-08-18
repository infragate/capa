import { info, isYes, prompt } from '../ui';
import type { Capabilities } from '../../types/capabilities';
import {
  collectExecutableSurface,
  fingerprintExecutableSurface,
  formatExecutableSurface,
  readConfirmedFingerprint,
  writeConfirmedFingerprint,
} from '../../shared/executable-surface';

export async function confirmInstallExecution(opts: {
  projectId: string;
  capabilities: Capabilities;
  dryRun?: boolean;
}): Promise<'proceed' | 'dry-run'> {
  const surface = collectExecutableSurface(opts.capabilities);
  const fingerprint = fingerprintExecutableSurface(surface);
  const summary = formatExecutableSurface(surface);

  const previous = readConfirmedFingerprint(opts.projectId);
  const changed = previous !== fingerprint;

  if (opts.dryRun || changed) {
    info('Executable surface for this install:');
    for (const line of summary.split('\n')) {
      info(line);
      if (opts.dryRun) console.log(line);
    }
  }

  if (opts.dryRun) {
    info('Dry run — no changes were made.');
    return 'dry-run';
  }

  if (!changed) {
    return 'proceed';
  }

  if (isYes()) {
    writeConfirmedFingerprint(opts.projectId, fingerprint);
    return 'proceed';
  }

  let ok: boolean;
  try {
    ok = await prompt.confirm(
      'Proceed with capa install? This will execute the commands above.',
      false,
    );
  } catch {
    throw new Error(
      'capa install requires confirmation of the executable surface. Re-run with --yes in non-interactive / CI environments.',
    );
  }
  if (!ok) {
    throw new Error('Install cancelled.');
  }
  writeConfirmedFingerprint(opts.projectId, fingerprint);
  return 'proceed';
}
