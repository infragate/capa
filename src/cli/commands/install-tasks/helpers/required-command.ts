import { exec } from 'child_process';
import { promisify } from 'util';
import type { RequiredCommand } from '../../../../types/capabilities';

const execAsync = promisify(exec);

const VALID_REQUIRES_COMMAND_CLI = /^[a-zA-Z0-9_.+-]+$/;

function assertValidRequiresCommandCli(cli: string): void {
  if (!VALID_REQUIRES_COMMAND_CLI.test(cli)) {
    throw new Error(
      `Invalid command name in capabilities requiresCommands: ${cli}. Only [a-zA-Z0-9_.+-] characters are allowed.`
    );
  }
}

export async function checkRequiredCommand(cmd: RequiredCommand): Promise<void> {
  assertValidRequiresCommandCli(cmd.cli);
  const isWindows = process.platform === 'win32';
  const checkCmd = isWindows ? `where ${cmd.cli}` : `which ${cmd.cli}`;
  try {
    await execAsync(checkCmd);
  } catch {
    const desc = cmd.description ? ` — ${cmd.description}` : '';
    throw new Error(`${cmd.cli} not found${desc}`);
  }
}
