import type { Task } from '../../ui';
import type { RequiredCommand } from '../../../types/capabilities';
import type { InstallCtx } from './context';

import { verifyPrerequisitesTask } from './verify-prerequisites';
import { resolvePluginsTask } from './resolve-plugins';
import { validatePluginConfigTask } from './validate-plugin-config';
import { loadEnvTask } from './load-env';
import { checkRemovedSkillsTask } from './check-removed-skills';
import { installSkillsTask } from './install-skills';
import { writeLockfileTask } from './write-lockfile';
import { installAgentInstructionsTask } from './install-agent-instructions';
import { pruneOrphanRulesTask } from './prune-orphan-rules';
import { installRulesTask } from './install-rules';
import { configureToolsTask } from './configure-tools';
import { registerMcpServerTask } from './register-mcp-server';
import { installSubagentsTask } from './install-subagents';
import { validateSubagentRefsTask } from './validate-subagent-refs';
import { pruneOrphanHooksTask } from './prune-orphan-hooks';
import { installHooksTask } from './install-hooks';
import { openCredentialSetupTask } from './open-credential-setup';

export type { InstallCtx, InstallOptions, GetRepoSnapshotFn, SkillInstallOutcome } from './context';

export function buildInstallTasks(reqCmds?: RequiredCommand[]): Task<InstallCtx>[] {
  const tasks: Task<InstallCtx>[] = [];

  if (reqCmds && reqCmds.length > 0) {
    tasks.push(verifyPrerequisitesTask(reqCmds));
  }

  tasks.push(
    resolvePluginsTask(),
    validatePluginConfigTask(),
    loadEnvTask(),
    checkRemovedSkillsTask(),
    installSkillsTask(),
    writeLockfileTask(),
    installAgentInstructionsTask(),
    pruneOrphanRulesTask(),
    installRulesTask(),
    configureToolsTask(),
    registerMcpServerTask(),
    validateSubagentRefsTask(),
    installSubagentsTask(),
    pruneOrphanHooksTask(),
    installHooksTask(),
    openCredentialSetupTask(),
  );

  return tasks;
}
