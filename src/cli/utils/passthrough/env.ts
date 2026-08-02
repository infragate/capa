import { resolve } from 'path';
import { existsSync } from 'fs';
import { resolveProviders } from '../../../shared/providers/resolve';
import { loadSettings, getDatabasePath } from '../../../shared/config';
import { CapaDatabase } from '../../../db/database';
import type { Capabilities } from '../../../types/capabilities';

export function expandEnvInRecord(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
      return process.env[name] ?? '';
    });
  }
  return out;
}

export async function loadEnvFileOptional(envFile: string | boolean | undefined): Promise<void> {
  if (envFile === undefined || envFile === false) return;
  const { parseEnvFile } = await import('../../../shared/env-parser');
  const path = envFile === true ? resolve(process.cwd(), '.env') : resolve(process.cwd(), String(envFile));
  if (!existsSync(path)) {
    throw new Error(`Environment file not found: ${path}`);
  }
  const vars = parseEnvFile(path);
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export async function openAuthDb(): Promise<{ db: CapaDatabase; settings: Awaited<ReturnType<typeof loadSettings>> }> {
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));
  return { db, settings };
}

export async function resolvePassthroughProviders(flagProvider?: string): Promise<string[]> {
  return resolveProviders({
    flagProvider,
    promptMessage: 'Which provider do you want to write files for?',
    missingHint:
      'No provider specified. Pass --provider <id> (required in non-interactive mode).\n\n' +
      '  Example: capa add … --passthrough -p cursor',
  });
}

export function emptyCapabilities(providers: string[]): Capabilities {
  return {
    providers,
    skills: [],
    servers: [],
    tools: [],
  };
}
