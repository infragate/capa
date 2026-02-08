import { startServer } from '../utils/server-manager';

export async function startCommand(foreground: boolean = false): Promise<void> {
  await startServer(!foreground);
  
  if (!foreground) {
    console.log('Use "capa stop" to stop the server');
  }
}
