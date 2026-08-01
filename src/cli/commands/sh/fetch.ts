import { resolve } from 'path';
import { getDatabasePath, loadSettings } from '../../../shared/config';
import { CapaDatabase } from '../../../db/database';
import type { Capabilities } from '../../../types/capabilities';
import { isUnderWrapWorkspacesDir } from '../../../shared/workspaces/paths';
import { CAPA_RAW_ARG } from '../../../server/tool-formatter';
import type { ShellCommand, ShellToolInfo } from './registry';
import { buildArgSlugs } from './args';

async function fetchShellTools(serverUrl: string, projectId: string): Promise<ShellToolInfo[]> {
  const response = await fetch(`${serverUrl}/api/projects/${projectId}/shell-tools`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to fetch shell tools (${response.status}): ${body}`);
  }
  const data = (await response.json()) as { tools: ShellToolInfo[] };
  return data.tools;
}

function isProjectNotReadyError(message: string): boolean {
  return /Project not configured|Project not found/i.test(message);
}

/**
 * Ensure the project exists in the DB and has capabilities loaded on the server.
 * Needed when `capa sh` runs from a wrap workspace after a partial install, or
 * before any successful configure for this identity path.
 */
async function ensureProjectConfigured(
  serverUrl: string,
  projectId: string,
  identityPath: string,
  capabilities: Capabilities,
): Promise<void> {
  if (isUnderWrapWorkspacesDir(identityPath)) {
    throw new Error(
      `Refusing to register wrap workspace path as a project: ${identityPath}`,
    );
  }

  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));
  try {
    const existing = db.getProject(projectId);
    if (existing) {
      const existingPath = resolve(existing.path);
      const wantPath = resolve(identityPath);
      const samePath =
        process.platform === 'win32'
          ? existingPath.toLowerCase() === wantPath.toLowerCase()
          : existingPath === wantPath;
      if (!samePath) {
        throw new Error(
          `Project id "${projectId}" is already registered at a different path:\n` +
            `  existing: ${existing.path}\n` +
            `  this:     ${identityPath}\n` +
            `Remove the conflicting project or reinstall from the correct directory.`,
        );
      }
    } else {
      db.upsertProject({ id: projectId, path: identityPath });
    }
  } finally {
    db.close();
  }

  const response = await fetch(`${serverUrl}/api/projects/${encodeURIComponent(projectId)}/configure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(capabilities),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to configure project: ${text}`);
  }
  await response.text().catch(() => '');
}

export async function fetchShellToolsWithConfigure(
  serverUrl: string,
  projectId: string,
  identityPath: string,
  capabilities: Capabilities,
): Promise<ShellToolInfo[]> {
  try {
    return await fetchShellTools(serverUrl, projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isProjectNotReadyError(message)) throw err;
    await ensureProjectConfigured(serverUrl, projectId, identityPath, capabilities);
    return await fetchShellTools(serverUrl, projectId);
  }
}

/**
 * Fetch the input schema for a single tool on demand. Used right before a tool is
 * run or `--help`'d. Throws a descriptive error (e.g. remote server down / timed
 * out / tool missing) which the caller surfaces for that one tool.
 */
async function fetchToolSchema(
  serverUrl: string,
  projectId: string,
  toolId: string
): Promise<{ description: string; inputSchema: any }> {
  const response = await fetch(
    `${serverUrl}/api/projects/${projectId}/shell-tool-schema?tool=${encodeURIComponent(toolId)}`,
    { signal: AbortSignal.timeout(20000) }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Failed to load schema for "${toolId}" (${response.status})`);
  }
  return await response.json() as { description: string; inputSchema: any };
}

/**
 * Ensure a command's input schema is loaded before it is run or `--help`'d.
 * Command tools already carry their schema; MCP tool schemas are fetched lazily
 * here so listing commands never blocks on (or fails because of) a remote server.
 */
export async function ensureSchema(
  cmd: ShellCommand,
  serverUrl: string,
  projectId: string
): Promise<void> {
  if (cmd.schemaLoaded) return;
  const { description, inputSchema } = await fetchToolSchema(serverUrl, projectId, cmd.id);
  cmd.inputSchema = inputSchema;
  cmd.argSlugs = buildArgSlugs(inputSchema);
  if (description) cmd.description = description;
  cmd.schemaLoaded = true;
}

export async function executeToolViaMCP(
  serverUrl: string,
  projectId: string,
  toolId: string,
  args: Record<string, any>,
  rawMode = false
): Promise<string> {
  const callArgs = rawMode ? { ...args, [CAPA_RAW_ARG]: true } : args;
  await fetch(`${serverUrl}/${projectId}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'capa-shell', version: '1.0' },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  const response = await fetch(`${serverUrl}/${projectId}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: toolId, arguments: callArgs },
    }),
    signal: AbortSignal.timeout(60000),
  });

  const data = await response.json() as any;

  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  const content = data.result?.content;
  if (Array.isArray(content) && content.length > 0) {
    return content.map((c: any) => (typeof c.text === 'string' ? c.text : JSON.stringify(c))).join('\n');
  }
  return JSON.stringify(data.result ?? data, null, 2);
}
