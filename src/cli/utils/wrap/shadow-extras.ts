/**
 * Post-install extras for wrap shadow workspaces: carry over real-project
 * provider config that exclusions would drop, and inject the VCS noise rule.
 */

import { installWrapProviderNoiseRule } from './provider-noise-rule';
import { syncWrapProviderConfig } from './provider-config-sync';

export function applyWrapShadowExtras(
  workspacePath: string,
  realProjectPath: string,
  providerId: string,
  exclusionProviderIds: Iterable<string>,
): void {
  syncWrapProviderConfig(workspacePath, realProjectPath, providerId);
  installWrapProviderNoiseRule(workspacePath, providerId, exclusionProviderIds);
}
