import type { AgentFileBase, AgentFileConfig, AgentSnippet } from '../../../../types/api';

export function normalizeAgents(agents: AgentFileConfig | null): AgentFileConfig {
  return {
    base: agents?.base ?? null,
    additional: agents?.additional ?? [],
  };
}

/** Strip nullish fields so YAML stays clean. */
export function toWritableAgents(next: AgentFileConfig): AgentFileConfig | null {
  const additional = next.additional
    .map((s) => {
      const out: Record<string, unknown> = { type: s.type };
      if (s.id) out.id = s.id;
      if (s.type === 'inline' && s.content) out.content = s.content;
      if (s.type === 'local' && s.path) out.path = s.path;
      if (s.type === 'remote' && s.url) out.url = s.url;
      if ((s.type === 'github' || s.type === 'gitlab') && s.def) out.def = s.def;
      return out as unknown as AgentSnippet;
    })
    .filter((s) => s.type);

  let base: AgentFileBase | undefined;
  if (next.base) {
    const b: Record<string, unknown> = {};
    if (next.base.type) b.type = next.base.type;
    if (next.base.path) b.path = next.base.path;
    if (next.base.ref) b.ref = next.base.ref;
    if (next.base.def) b.def = next.base.def;
    if (b.type || b.path || b.ref || b.def) {
      base = b as unknown as AgentFileBase;
    }
  }

  if (!base && additional.length === 0) return null;
  return {
    ...(base ? { base } : {}),
    ...(additional.length > 0 ? { additional } : {}),
  } as AgentFileConfig;
}
