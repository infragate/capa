import yaml from 'js-yaml';
import { z } from 'zod';
import type { Capabilities, CapabilitiesFormat } from '../types/capabilities';
import { logger } from './logger';

const KNOWN_CAPABILITY_KEYS = new Set([
  'providers',
  'skills',
  'servers',
  'tools',
  'plugins',
  'resolvedPlugins',
  'options',
  'agents',
  'subagents',
  'rules',
]);

const objectEntry = z.record(z.string(), z.unknown());

const capabilitiesSchema = z
  .object({
    providers: z.array(z.string()).optional(),
    skills: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    servers: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    tools: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    plugins: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    resolvedPlugins: z.array(objectEntry).optional(),
    options: z.preprocess((val) => val ?? {}, z.record(z.string(), z.unknown())),
    agents: z.record(z.string(), z.unknown()).optional(),
    subagents: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    rules: z.preprocess((val) => val ?? [], z.array(objectEntry)),
  })
  .passthrough();

export function normalizeCapabilities(parsed: unknown): Capabilities {
  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new Error('capabilities file is empty or not a YAML/JSON object');
  }

  const result = capabilitiesSchema.parse(parsed);

  for (const key of Object.keys(parsed)) {
    if (!KNOWN_CAPABILITY_KEYS.has(key)) {
      logger.warn(`capabilities: unknown top-level key "${key}"`);
    }
  }

  return result as unknown as Capabilities;
}

export async function parseCapabilitiesFile(
  path: string,
  format: CapabilitiesFormat
): Promise<Capabilities> {
  const file = Bun.file(path);
  const content = await file.text();

  if (format === 'json') {
    return normalizeCapabilities(JSON.parse(content));
  } else {
    return normalizeCapabilities(yaml.load(content));
  }
}

export function createDefaultCapabilities(): Capabilities {
  return {
    options: {
      toolExposure: 'on-demand',
    },
    skills: [
      {
        id: 'capabilities-manager',
        type: 'github',
        def: {
          repo: 'infragate/capa@capabilities-manager',
          description: 'Guide for managing capabilities with capa CLI',
        },
      },
    ],
    servers: [],
    tools: [],
  };
}

export async function writeCapabilitiesFile(
  path: string,
  format: CapabilitiesFormat,
  capabilities: Capabilities
): Promise<void> {
  let content: string;

  if (format === 'json') {
    content = JSON.stringify(capabilities, null, 2);
  } else {
    content = yaml.dump(capabilities, { indent: 2 });
  }

  await Bun.write(path, content);
}
