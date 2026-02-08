import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import type { ServerSettings } from '../types/database';

const DEFAULT_SETTINGS: ServerSettings = {
  version: '1.0.0',
  server: {
    port: 5912,
    host: '127.0.0.1',
  },
  database: {
    path: '~/.capa/capa.db',
  },
  session: {
    timeout_minutes: 60,
  },
};

export function getCapaDir(): string {
  return join(homedir(), '.capa');
}

export function getSettingsPath(): string {
  return join(getCapaDir(), 'settings.json');
}

export function getDatabasePath(settings?: ServerSettings): string {
  const path = settings?.database.path ?? DEFAULT_SETTINGS.database.path;
  return path.replace('~', homedir());
}

export function getPidFilePath(): string {
  return join(getCapaDir(), 'server.pid');
}

export async function ensureCapaDir(): Promise<void> {
  const capaDir = getCapaDir();
  if (!existsSync(capaDir)) {
    await mkdir(capaDir, { recursive: true });
  }
}

export async function loadSettings(): Promise<ServerSettings> {
  const settingsPath = getSettingsPath();
  
  if (!existsSync(settingsPath)) {
    await ensureCapaDir();
    await Bun.write(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return DEFAULT_SETTINGS;
  }

  try {
    const file = Bun.file(settingsPath);
    const settings = await file.json();
    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (error) {
    console.error('Failed to load settings, using defaults:', error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: ServerSettings): Promise<void> {
  await ensureCapaDir();
  const settingsPath = getSettingsPath();
  await Bun.write(settingsPath, JSON.stringify(settings, null, 2));
}
