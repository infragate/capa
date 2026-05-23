import type { Task } from '../../ui';
import type { InstallCtx } from './context';
import { checkGitInstalled, gitOAuthHelpText } from './helpers/git';
import { installOneSkill } from './helpers/install-one-skill';
import { indentLines } from './helpers/text';

export function installSkillsTask(): Task<InstallCtx> {
  return {
    title: 'Installing skills',
    task: async (ctx, task) => {
      const providers = ctx.capabilitiesToUse.providers ?? ctx.resolvedProviders;
      const needsGit = ctx.capabilities.skills.some(
        (skill) => skill.type === 'github' || skill.type === 'gitlab',
      );
      if (needsGit) {
        const gitInstalled = await checkGitInstalled();
        if (!gitInstalled) {
          const lines = gitOAuthHelpText().split('\n');
          throw new Error(
            'Git is not installed on your system.\n\n' +
              lines.map((line) => (line ? `  ${line}` : '')).join('\n'),
          );
        }
      }
      const totalSkills = ctx.capabilities.skills.length;
      const failedBefore = ctx.failed;

      for (let i = 0; i < totalSkills; i++) {
        const skill = ctx.capabilities.skills[i];
        task.output = `[${i + 1}/${totalSkills}] ${skill.id}`;

        let outcome;
        try {
          outcome = await installOneSkill(
            skill,
            ctx.projectPath,
            ctx.projectId,
            providers,
            ctx.db,
            ctx.settings,
            ctx.capabilitiesToUse,
            ctx.capabilitiesFile.path,
            ctx.lockBuilder,
            ctx.noCache,
            ctx.resolvedRepos,
          );
        } catch (err: unknown) {
          ctx.failed++;
          const message = err instanceof Error ? err.message : String(err);
          ctx.errors.push(`Skill "${skill.id}" failed:\n${indentLines(message, '    ')}`);
          continue;
        }

        if (outcome === 'installed') ctx.added++;
        else if (outcome === 'skipped') ctx.skipped++;
        else {
          ctx.failed++;
          ctx.errors.push(`Skill "${skill.id}" failed (see logs above)`);
        }
      }

      const failedInTask = ctx.failed - failedBefore;
      if (failedInTask > 0) {
        task.title = `Installing skills — ${failedInTask} of ${totalSkills} failed`;
        throw new Error(
          `${failedInTask} of ${totalSkills} skill(s) failed to install. ` +
            `See the errors above for details.`,
        );
      }
      task.title = `Installed ${totalSkills} skill${totalSkills === 1 ? '' : 's'}`;
    },
  };
}
