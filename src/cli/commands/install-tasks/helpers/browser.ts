import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function openBrowser(url: string): Promise<boolean> {
  try {
    const platform = process.platform;
    let command: string;
    if (platform === 'win32') {
      command = `start "" "${url}"`;
    } else if (platform === 'darwin') {
      command = `open "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }
    await execAsync(command);
    return true;
  } catch {
    return false;
  }
}
