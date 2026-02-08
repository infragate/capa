import { stopServer } from '../utils/server-manager';

export async function stopCommand(): Promise<void> {
  await stopServer();
}
