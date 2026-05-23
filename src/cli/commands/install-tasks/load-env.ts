import { existsSync } from 'fs';
import { resolve } from 'path';
import type { Task } from '../../ui';
import { parseEnvFile } from '../../../shared/env-parser';
import { extractAllVariables } from '../../../shared/variable-resolver';
import type { InstallCtx } from './context';

export function loadEnvTask(): Task<InstallCtx> {
  return {
    title: 'Loading environment variables',
    enabled: (ctx) => ctx.envFile !== undefined,
    task: async (ctx) => {
      let envFilePath: string;
      if (typeof ctx.envFile === 'boolean' && ctx.envFile) {
        envFilePath = resolve(ctx.projectPath, '.env');
      } else if (typeof ctx.envFile === 'string') {
        envFilePath = resolve(ctx.projectPath, ctx.envFile);
      } else {
        envFilePath = resolve(ctx.projectPath, '.env');
      }

      if (!existsSync(envFilePath)) {
        throw new Error(
          `Environment file not found: ${envFilePath}\n\n` +
            '  When using -e or --env flag, the specified .env file must exist.\n' +
            '  Please create the file or run without the flag to use the web UI.\n',
        );
      }

      let envVariables: Record<string, string>;
      try {
        envVariables = parseEnvFile(envFilePath);
      } catch (error: any) {
        throw new Error(`Failed to parse env file: ${error.message}`);
      }

      const requiredVars = extractAllVariables(ctx.capabilitiesToUse);
      for (const varName of requiredVars) {
        if (envVariables[varName]) {
          ctx.db.setVariable(ctx.projectId, varName, envVariables[varName]);
        } else {
          ctx.warnings.push(`Variable ${varName} not found in env file`);
        }
      }

      const missingVars: string[] = [];
      for (const varName of requiredVars) {
        const value = ctx.db.getVariable(ctx.projectId, varName);
        if (!value) {
          missingVars.push(varName);
        }
      }

      if (missingVars.length > 0) {
        throw new Error(
          `Missing required variables: ${missingVars.join(', ')}\n` +
            '  These variables are required but were not found in the env file.\n' +
            '  Please add them to your env file and try again.\n',
        );
      }
    },
  };
}
