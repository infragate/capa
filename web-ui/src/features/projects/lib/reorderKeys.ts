import type { Server, Skill, SourcePlugin } from '../../../types/api';

/** Reorder key for skills — plugin-sourced skills are prefixed to avoid id collisions. */
export function skillReorderKey(skill: {
  id: string;
  sourcePlugin?: SourcePlugin | null;
}): string {
  if (skill.sourcePlugin?.name) {
    return `plugin:${skill.sourcePlugin.name}:${skill.id}`;
  }
  return skill.id;
}

/** Reorder key for servers — plugin-sourced servers are prefixed to avoid id collisions. */
export function serverReorderKey(server: {
  id: string;
  sourcePlugin?: SourcePlugin | null;
}): string {
  if (server.sourcePlugin?.name) {
    return `plugin:${server.sourcePlugin.name}:${server.id}`;
  }
  return server.id;
}

export function isPluginSourced(entry: {
  sourcePlugin?: SourcePlugin | null;
}): boolean {
  return !!entry.sourcePlugin;
}

export function reorderByKey<T>(
  items: T[],
  keys: string[],
  getKey: (item: T) => string,
): T[] {
  const byKey = new Map<string, T>();
  const rest: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (byKey.has(key)) rest.push(item);
    else byKey.set(key, item);
  }
  const next: T[] = [];
  for (const key of keys) {
    const item = byKey.get(key);
    if (item) {
      next.push(item);
      byKey.delete(key);
    }
  }
  next.push(...byKey.values(), ...rest);
  return next;
}

export function authoredReorderKeys<T extends { sourcePlugin?: SourcePlugin | null }>(
  items: T[],
  orderedKeys: string[],
  getKey: (item: T) => string,
): string[] {
  const byKey = new Map(items.map((item) => [getKey(item), item]));
  return orderedKeys.filter((key) => {
    const item = byKey.get(key);
    return item && !item.sourcePlugin;
  });
}

export type { Skill, Server };
