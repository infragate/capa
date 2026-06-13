import yaml from 'js-yaml';
import { parseDocument, isSeq } from 'yaml';
import { z } from 'zod';
import type { Capabilities, CapabilitiesFormat } from '../types/capabilities';
import { logger } from './logger';

const KNOWN_CAPABILITY_KEYS = new Set([
  'providers',
  'skills',
  'servers',
  'tools',
  'plugins',
  'options',
  'agents',
  'subagents',
  'rules',
  'hooks',
]);

const objectEntry = z.record(z.string(), z.unknown());

const capabilitiesSchema = z
  .object({
    providers: z.array(z.string()).optional(),
    skills: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    servers: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    tools: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    plugins: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    options: z.preprocess((val) => val ?? {}, z.record(z.string(), z.unknown())),
    agents: z.record(z.string(), z.unknown()).optional(),
    subagents: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    rules: z.preprocess((val) => val ?? [], z.array(objectEntry)),
    hooks: z.preprocess((val) => val ?? [], z.array(objectEntry)),
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
      {
        id: 'bootstrap',
        type: 'github',
        def: {
          repo: 'infragate/capa@bootstrap',
          description:
            'Capify an existing project: discover skills/rules/hooks/MCP servers across all providers and synthesize capabilities.yaml',
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

type ArrayCapabilitySection =
  | 'skills'
  | 'servers'
  | 'tools'
  | 'plugins'
  | 'subagents'
  | 'rules'
  | 'hooks';

/**
 * Append a single entry to one of the array-valued capability sections,
 * preserving the rest of the file verbatim — comments, key ordering, and
 * formatting all survive. Used by `capa add` so editing the file in place
 * never rearranges what the user already wrote.
 *
 * The entry is added at the end of the target section's list. If the section
 * is missing it is created.
 */
export async function appendCapabilityEntry(
  path: string,
  format: CapabilitiesFormat,
  section: ArrayCapabilitySection,
  entry: Record<string, unknown>
): Promise<void> {
  const content = await Bun.file(path).text();

  if (format === 'json') {
    const data = JSON.parse(content) as Record<string, unknown>;
    const list = Array.isArray(data[section]) ? (data[section] as unknown[]) : [];
    list.push(entry);
    data[section] = list;
    await Bun.write(path, JSON.stringify(data, null, 2) + '\n');
    return;
  }

  const doc = parseDocument(content);
  const existing = doc.get(section);
  if (isSeq(existing)) {
    existing.add(doc.createNode(entry));
  } else {
    doc.set(section, doc.createNode([entry]));
  }
  await Bun.write(path, doc.toString());
}
