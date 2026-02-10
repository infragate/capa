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
    skills: [
      {
        id: 'capabilities-manager',
        type: 'github',
        def: {
          repo: 'infragate/capa@capabilities-manager',
          description: 'Guide for managing capabilities with capa CLI',
          requires: ['capa_init', 'capa_install', 'find_skills']
        }
      }
    ],
    servers: [],
    tools: [
      {
        id: 'capa_init',
        type: 'command',
        def: {
          run: {
            cmd: 'capa init',
            args: []
          }
        }
      },
      {
        id: 'capa_install',
        type: 'command',
        def: {
          run: {
            cmd: 'capa install',
            args: []
          }
        }
      },
      {
        id: 'find_skills',
        type: 'command',
        def: {
          init: {
            cmd: 'npx skills@latest'
          },
          run: {
            cmd: 'npx skills find {query}',
            args: [
              {
                name: 'query',
                type: 'string',
                description: 'Search query for finding skills',
                required: true
              }
            ]
          }
        }
      }
    ]
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
