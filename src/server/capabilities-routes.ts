import type { CapaDatabase } from '../db/database';
import type { RegistryManager } from '../shared/registries/manager';
import type { AgentFileConfig, Capabilities, CapabilitiesFormat } from '../types/capabilities';
import type { RegistryCapability } from '../types/registry';
import type { Skill } from '../types/capabilities';
import type { Plugin } from '../types/plugin';
import { detectCapabilitiesFile } from '../shared/paths';
import {
  appendCapabilityEntry,
  parseCapabilitiesFile,
  removeCapabilityEntry,
  reorderCapabilityEntries,
  updateCapabilityEntry,
  upsertAgents,
  upsertOptions,
  type ArrayCapabilitySection,
  type OptionsPatch,
} from '../shared/capabilities';
import { extractAllVariables } from '../shared/variable-resolver';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const ARRAY_SECTIONS = new Set<ArrayCapabilitySection>([
  'skills',
  'servers',
  'tools',
  'plugins',
  'subagents',
  'rules',
  'hooks',
]);

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export type ConfigureAfterWrite = (
  projectId: string,
  capabilities: Capabilities,
) => Promise<Record<string, unknown>>;

export interface CapabilitiesRouteDeps {
  db: CapaDatabase;
  registryManager: RegistryManager;
  configure: ConfigureAfterWrite;
  /** Called around capa-owned file writes so the disk watcher can ignore them. */
  markSelfWrite?: (projectId: string) => void;
  /** Notify live UI clients after a successful write+configure. */
  notifyChanged?: (projectId: string) => void;
}

async function resolveCapabilitiesFile(projectPath: string): Promise<{
  path: string;
  format: CapabilitiesFormat;
} | null> {
  return detectCapabilitiesFile(projectPath);
}

async function loadProjectFile(
  db: CapaDatabase,
  projectId: string,
): Promise<
  | { ok: true; projectPath: string; path: string; format: CapabilitiesFormat; caps: Capabilities }
  | { ok: false; response: Response }
> {
  const project = db.getProject(projectId);
  if (!project) {
    return { ok: false, response: jsonError('Project not found', 404) };
  }
  const file = await resolveCapabilitiesFile(project.path);
  if (!file) {
    return {
      ok: false,
      response: jsonError('No capabilities.yaml or capabilities.json found in project', 404),
    };
  }
  const caps = await parseCapabilitiesFile(file.path, file.format);
  return { ok: true, projectPath: project.path, path: file.path, format: file.format, caps };
}

async function afterWrite(
  deps: CapabilitiesRouteDeps,
  projectId: string,
  path: string,
  format: CapabilitiesFormat,
): Promise<Response> {
  deps.markSelfWrite?.(projectId);
  const caps = await parseCapabilitiesFile(path, format);
  const configureResult = await deps.configure(projectId, caps);
  deps.notifyChanged?.(projectId);
  return jsonOk({
    success: true,
    ...configureResult,
  });
}

function entryId(entry: Record<string, unknown>): string | undefined {
  return typeof entry.id === 'string' ? entry.id : undefined;
}

function findById(caps: Capabilities, section: ArrayCapabilitySection, id: string): unknown {
  const list = (caps as Record<string, unknown>)[section];
  if (!Array.isArray(list)) return undefined;
  return list.find((item) => asObj(item)?.id === id);
}

function asObj(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function isPluginSourced(entry: unknown): boolean {
  const obj = asObj(entry);
  return !!(obj?.sourcePlugin);
}

/**
 * Route dispatcher for `/api/projects/:id/capabilities…` mutations.
 * Returns null if the path is not a capabilities mutation route.
 */
export async function handleCapabilitiesMutation(
  deps: CapabilitiesRouteDeps,
  projectId: string,
  path: string,
  method: string,
  request: Request,
): Promise<Response | null> {
  const base = `/api/projects/${projectId}/capabilities`;
  if (!path.startsWith(base)) return null;

  const rest = path.slice(base.length);

  // PATCH /capabilities/options
  if (rest === '/options' && method === 'PATCH') {
    return handlePatchOptions(deps, projectId, request);
  }

  // PUT /capabilities/agents — replace or clear the agents object
  if (rest === '/agents' && method === 'PUT') {
    return handlePutAgents(deps, projectId, request);
  }

  // POST /capabilities/skills/from-registry
  if (rest === '/skills/from-registry' && method === 'POST') {
    return handleFromRegistry(deps, projectId, request, 'skills');
  }

  // POST /capabilities/plugins/from-registry
  if (rest === '/plugins/from-registry' && method === 'POST') {
    return handleFromRegistry(deps, projectId, request, 'plugins');
  }

  // POST /capabilities/:section
  const postMatch = rest.match(/^\/(skills|servers|tools|plugins|subagents|rules|hooks)$/);
  if (postMatch && method === 'POST') {
    return handleAppend(deps, projectId, postMatch[1] as ArrayCapabilitySection, request);
  }

  // PUT /capabilities/:section/order
  const orderMatch = rest.match(
    /^\/(skills|servers|tools|plugins|subagents|rules|hooks)\/order$/,
  );
  if (orderMatch && method === 'PUT') {
    return handleReorder(deps, projectId, orderMatch[1] as ArrayCapabilitySection, request);
  }

  // PATCH|DELETE /capabilities/:section/:entryId
  const entryMatch = rest.match(
    /^\/(skills|servers|tools|plugins|subagents|rules|hooks)\/([^/]+)$/,
  );
  if (entryMatch) {
    const section = entryMatch[1] as ArrayCapabilitySection;
    const entryIdParam = decodeURIComponent(entryMatch[2]);
    if (method === 'PATCH') {
      return handleUpdate(deps, projectId, section, entryIdParam, request);
    }
    if (method === 'DELETE') {
      return handleDelete(deps, projectId, section, entryIdParam, request);
    }
  }

  return null;
}

async function handleAppend(
  deps: CapabilitiesRouteDeps,
  projectId: string,
  section: ArrayCapabilitySection,
  request: Request,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const id = entryId(body);
  if (!id) {
    return jsonError('Entry must include a string "id"', 400);
  }

  const loaded = await loadProjectFile(deps.db, projectId);
  if (!loaded.ok) return loaded.response;

  if (findById(loaded.caps, section, id)) {
    return jsonError(`${section.slice(0, -1)} with id "${id}" already exists`, 409);
  }

  try {
    await appendCapabilityEntry(loaded.path, loaded.format, section, body);
    return await afterWrite(deps, projectId, loaded.path, loaded.format);
  } catch (err: any) {
    return jsonError(err?.message ?? String(err), 400);
  }
}

async function handleReorder(
  deps: CapabilitiesRouteDeps,
  projectId: string,
  section: ArrayCapabilitySection,
  request: Request,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    return jsonError('Body must include an "ids" array of strings', 400);
  }

  const loaded = await loadProjectFile(deps.db, projectId);
  if (!loaded.ok) return loaded.response;

  try {
    await reorderCapabilityEntries(loaded.path, loaded.format, section, ids as string[]);
    return await afterWrite(deps, projectId, loaded.path, loaded.format);
  } catch (err: any) {
    return jsonError(err?.message ?? String(err), 400);
  }
}

async function handleUpdate(
  deps: CapabilitiesRouteDeps,
  projectId: string,
  section: ArrayCapabilitySection,
  id: string,
  request: Request,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const loaded = await loadProjectFile(deps.db, projectId);
  if (!loaded.ok) return loaded.response;

  const existing = findById(loaded.caps, section, id);
  if (!existing) {
    return jsonError(`${section.slice(0, -1)} "${id}" not found`, 404);
  }
  if (isPluginSourced(existing) && (section === 'skills' || section === 'servers')) {
    return jsonError(
      `Cannot edit plugin-sourced ${section.slice(0, -1)}; remove the plugin instead`,
      400,
    );
  }

  // If renaming id, ensure uniqueness
  const nextId = typeof body.id === 'string' ? body.id : id;
  if (nextId !== id && findById(loaded.caps, section, nextId)) {
    return jsonError(`${section.slice(0, -1)} with id "${nextId}" already exists`, 409);
  }

  try {
    const updated = await updateCapabilityEntry(
      loaded.path,
      loaded.format,
      section,
      (e) => e.id === id,
      (e) => {
        const merged = { ...e, ...body, id: nextId };
        if (asObj(body.def)) {
          // Servers: replace def wholesale so mode switches (HTTP↔stdio) don't
          // leave stale url/cmd fields behind. Other sections keep shallow merge.
          if (section === 'servers') {
            merged.def = asObj(body.def)!;
          } else if (asObj(e.def)) {
            merged.def = { ...asObj(e.def)!, ...asObj(body.def)! };
          }
        }
        return merged;
      },
    );
    if (!updated) {
      return jsonError(`${section.slice(0, -1)} "${id}" not found`, 404);
    }

    // When renaming a server, cascade id updates into tool def.server refs
    if (section === 'servers' && nextId !== id) {
      const capsAfter = await parseCapabilitiesFile(loaded.path, loaded.format);
      for (const tool of capsAfter.tools || []) {
        const def = asObj(tool.def);
        if (!def) continue;
        const serverRef = typeof def.server === 'string' ? def.server : '';
        const bare = serverRef.replace(/^@/, '');
        if (bare !== id) continue;
        await updateCapabilityEntry(
          loaded.path,
          loaded.format,
          'tools',
          (e) => e.id === tool.id,
          (e) => {
            const d = asObj(e.def) ?? {};
            return {
              ...e,
              def: {
                ...d,
                server: serverRef.startsWith('@') ? `@${nextId}` : nextId,
              },
            };
          },
        );
      }
    }

    // When renaming a tool, cascade id updates into skill.requires and subagent.tools
    if (section === 'tools' && nextId !== id) {
      const capsAfter = await parseCapabilitiesFile(loaded.path, loaded.format);
      const rewriteRef = (ref: string): string => {
        if (ref === id) return nextId;
        const at = ref.startsWith('@');
        const stripped = at ? ref.slice(1) : ref;
        if (stripped.endsWith(`.${id}`)) {
          return `${at ? '@' : ''}${stripped.slice(0, -id.length)}${nextId}`;
        }
        return ref;
      };
      for (const skill of capsAfter.skills || []) {
        const requires = skill.def?.requires;
        if (!Array.isArray(requires) || !requires.some((r) => rewriteRef(r) !== r)) continue;
        await updateCapabilityEntry(
          loaded.path,
          loaded.format,
          'skills',
          (e) => e.id === skill.id,
          (e) => {
            const def = asObj(e.def) ?? {};
            const req = Array.isArray(def.requires) ? [...(def.requires as string[])] : [];
            return {
              ...e,
              def: {
                ...def,
                requires: req.map(rewriteRef),
              },
            };
          },
        );
      }
      for (const agent of capsAfter.subagents || []) {
        if (!Array.isArray(agent.tools) || !agent.tools.some((r) => rewriteRef(r) !== r)) continue;
        await updateCapabilityEntry(
          loaded.path,
          loaded.format,
          'subagents',
          (e) => e.id === agent.id,
          (e) => {
            const tools = Array.isArray(e.tools) ? [...(e.tools as string[])] : [];
            return {
              ...e,
              tools: tools.map(rewriteRef),
            };
          },
        );
      }
    }

    return await afterWrite(deps, projectId, loaded.path, loaded.format);
  } catch (err: any) {
    return jsonError(err?.message ?? String(err), 400);
  }
}

async function handleDelete(
  deps: CapabilitiesRouteDeps,
  projectId: string,
  section: ArrayCapabilitySection,
  id: string,
  request: Request,
): Promise<Response> {
  const loaded = await loadProjectFile(deps.db, projectId);
  if (!loaded.ok) return loaded.response;

  const existing = findById(loaded.caps, section, id);
  if (!existing) {
    return jsonError(`${section.slice(0, -1)} "${id}" not found`, 404);
  }
  if (isPluginSourced(existing) && (section === 'skills' || section === 'servers')) {
    return jsonError(
      `Cannot delete plugin-sourced ${section.slice(0, -1)}; remove the plugin instead`,
      400,
    );
  }

  const url = new URL(request.url);
  const cascadeTools = url.searchParams.get('cascadeTools') === 'true';

  try {
    const removed = await removeCapabilityEntry(
      loaded.path,
      loaded.format,
      section,
      (e) => e.id === id,
    );
    if (removed === 0) {
      return jsonError(`${section.slice(0, -1)} "${id}" not found`, 404);
    }

    if (section === 'servers' && cascadeTools) {
      await removeCapabilityEntry(
        loaded.path,
        loaded.format,
        'tools',
        (e) => {
          const def = asObj(e.def);
          if (!def || e.type !== 'mcp') return false;
          const server = typeof def.server === 'string' ? def.server.replace(/^@/, '') : '';
          return server === id;
        },
      );
    }

    return await afterWrite(deps, projectId, loaded.path, loaded.format);
  } catch (err: any) {
    return jsonError(err?.message ?? String(err), 400);
  }
}

async function handlePatchOptions(
  deps: CapabilitiesRouteDeps,
  projectId: string,
  request: Request,
): Promise<Response> {
  let body: OptionsPatch;
  try {
    body = (await request.json()) as OptionsPatch;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const loaded = await loadProjectFile(deps.db, projectId);
  if (!loaded.ok) return loaded.response;

  try {
    await upsertOptions(loaded.path, loaded.format, body);
    return await afterWrite(deps, projectId, loaded.path, loaded.format);
  } catch (err: any) {
    return jsonError(err?.message ?? String(err), 400);
  }
}

async function handlePutAgents(
  deps: CapabilitiesRouteDeps,
  projectId: string,
  request: Request,
): Promise<Response> {
  let body: { agents?: AgentFileConfig | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  if (!('agents' in body)) {
    return jsonError('Body must include an "agents" field (object or null)', 400);
  }

  const agents = body.agents;
  if (agents !== null && (typeof agents !== 'object' || Array.isArray(agents))) {
    return jsonError('"agents" must be an object or null', 400);
  }

  const loaded = await loadProjectFile(deps.db, projectId);
  if (!loaded.ok) return loaded.response;

  try {
    await upsertAgents(loaded.path, loaded.format, agents ?? null);
    return await afterWrite(deps, projectId, loaded.path, loaded.format);
  } catch (err: any) {
    return jsonError(err?.message ?? String(err), 400);
  }
}

async function handleFromRegistry(
  deps: CapabilitiesRouteDeps,
  projectId: string,
  request: Request,
  expectedCapability: RegistryCapability,
): Promise<Response> {
  let body: { registry?: string; itemId?: string; capability?: RegistryCapability };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const registryId = body.registry;
  const itemId = body.itemId;
  if (!registryId || !itemId) {
    return jsonError('Fields "registry" and "itemId" are required', 400);
  }

  const capability = body.capability ?? expectedCapability;

  const loaded = await loadProjectFile(deps.db, projectId);
  if (!loaded.ok) return loaded.response;

  try {
    const detail = await deps.registryManager.view(registryId, {
      capability,
      id: itemId,
    });
    const snippet = detail.installSnippet;
    const itemName =
      (snippet as { id?: string }).id ?? itemId.split('/').pop() ?? 'registry-item';

    if (capability === 'skills') {
      if (findById(loaded.caps, 'skills', itemName)) {
        return jsonError(`Skill with id "${itemName}" already exists`, 409);
      }
      const newSkill: Skill = { ...(snippet as Skill), id: itemName };
      await appendCapabilityEntry(
        loaded.path,
        loaded.format,
        'skills',
        newSkill as unknown as Record<string, unknown>,
      );
    } else {
      if (findById(loaded.caps, 'plugins', itemName)) {
        return jsonError(`Plugin with id "${itemName}" already exists`, 409);
      }
      const newPlugin = { ...(snippet as Plugin), id: itemName };
      await appendCapabilityEntry(
        loaded.path,
        loaded.format,
        'plugins',
        newPlugin as unknown as Record<string, unknown>,
      );
    }

    return await afterWrite(deps, projectId, loaded.path, loaded.format);
  } catch (err: any) {
    return jsonError(err?.message ?? String(err), 400);
  }
}

/** Variable catalog helpers used by the server. */
const INTERNAL_OAUTH_VAR = /^oauth2_client_(id|secret)_/;

export function buildVariablesResponse(
  capabilities: Capabilities | null,
  values: Record<string, string>,
): { required: string[]; catalog: string[]; values: Record<string, string> } {
  const required = (capabilities ? extractAllVariables(capabilities) : []).filter(
    (name) => !INTERNAL_OAUTH_VAR.test(name),
  );
  const catalog = Object.keys(values)
    .filter((name) => !INTERNAL_OAUTH_VAR.test(name))
    .sort();
  const publicValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!INTERNAL_OAUTH_VAR.test(key)) publicValues[key] = value;
  }
  return { required, catalog, values: publicValues };
}

export function isArrayCapabilitySection(value: string): value is ArrayCapabilitySection {
  return ARRAY_SECTIONS.has(value as ArrayCapabilitySection);
}
