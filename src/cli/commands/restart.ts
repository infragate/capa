import { restartServer } from '../utils/server-manager';

export async function restartCommand(): Promise<void> {
  await restartServer();
}
