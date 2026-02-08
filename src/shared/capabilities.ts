import yaml from 'js-yaml';
import type { Capabilities, CapabilitiesFormat } from '../types/capabilities';

export async function parseCapabilitiesFile(
  path: string,
  format: CapabilitiesFormat
): Promise<Capabilities> {
  const file = Bun.file(path);
  const content = await file.text();
  
  if (format === 'json') {
    return JSON.parse(content) as Capabilities;
  } else {
    return yaml.load(content) as Capabilities;
  }
}

export function createDefaultCapabilities(): Capabilities {
  return {
    clients: ['cursor', 'claude-code'],
    skills: [],
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
