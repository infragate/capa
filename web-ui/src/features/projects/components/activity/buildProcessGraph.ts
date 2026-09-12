import type { ToolCallRecord } from '../../../../types/api';
import { isCommandSpan } from './buildRunCommands';
import type { ActivityRun } from './groupActivityRuns';

/** Spans omitted from the process map (infra / lifecycle, not workflow steps). */
const SKIP_KINDS = new Set([
  'file',
  'stop',
  'session',
  'compact',
  'setup_tools',
  'search',
]);

/** Capa meta-tools (on-demand / search) — traced again as the real tool via `call_tool` / `tool`. */
const CAPA_META_TOOL_NAMES = new Set(['call_tool', 'setup_tools', 'search']);

/** Canonical labels for well-known agent tools. */
const TOOL_ALIASES: Record<string, string> = {
  read: 'Read',
  read_file: 'Read',
  readfile: 'Read',
  write: 'Write',
  grep: 'Grep',
  glob: 'Glob',
  delete: 'Delete',
  strreplace: 'StrReplace',
  str_replace: 'StrReplace',
  strreplaceeditor: 'StrReplace',
  applypatch: 'ApplyPatch',
  apply_patch: 'ApplyPatch',
  editnotebook: 'EditNotebook',
  task: 'Task',
  listdir: 'ListDir',
  list_dir: 'ListDir',
  websearch: 'WebSearch',
  webfetch: 'WebFetch',
};

export const PROMPT_NODE_ID = 'Prompt';
export const SHELL_NODE_ID = 'Shell';

export type ProcessActivity = {
  id: string;
  toolName: string;
  label: string;
  /** Mean position in traces (for layout). */
  avgIndex: number;
  /** Render as the run start node. */
  isStart?: boolean;
  /** Skill node — show full name without truncation. */
  isSkill?: boolean;
};

export type ProcessEdge = {
  from: string;
  to: string;
  count: number;
};

export type ProcessGraph = {
  activities: ProcessActivity[];
  edges: ProcessEdge[];
  nodeCounts: Record<string, number>;
  nodeErrorCounts: Record<string, number>;
  traceCount: number;
};

function parseArgs(argsJson: string | null): Record<string, unknown> | null {
  if (!argsJson?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function pathFromArgs(args: Record<string, unknown> | null): string | null {
  if (!args) return null;
  for (const key of ['path', 'file_path', 'filePath', 'target_file', 'targetFile']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function skillNameFromSpan(ev: ToolCallRecord): string {
  const fromName = ev.tool_name?.trim();
  if (fromName && fromName.toLowerCase() !== 'skill') return fromName;
  const path = pathFromArgs(parseArgs(ev.args_json));
  if (path) {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const skillIdx = parts.findIndex((p) => p.toLowerCase() === 'skill.md');
    if (skillIdx > 0) return parts[skillIdx - 1]!.trim() || 'skill';
  }
  return 'skill';
}

function canonicalAgentToolName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'Tool';
  return TOOL_ALIASES[trimmed] ?? TOOL_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** Provider MCP / Cursor wrappers around capa's `call_tool` / `setup_tools` meta-tools. */
export function isCapaMetaToolWrapperSpan(ev: ToolCallRecord): boolean {
  const name = ev.tool_name?.trim() ?? '';
  if (ev.kind === 'agent_mcp' && CAPA_META_TOOL_NAMES.has(name)) {
    return true;
  }
  if (ev.kind === 'agent_tool' && /^MCP:(call_tool|setup_tools)$/i.test(name)) {
    return true;
  }
  return false;
}

/** Label/id for provider-native MCP tools (not capa `tool` / `call_tool` spans). */
function nativeMcpToolName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'MCP';
  if (/^MCP:/i.test(trimmed)) return trimmed.slice(4).trim() || 'MCP';
  return trimmed;
}

function capaToolActivityId(toolName: string): string {
  return `capa:${toolName}`;
}

function capaToolActivity(toolName: string): ProcessActivity {
  return {
    id: capaToolActivityId(toolName),
    toolName,
    label: toolName,
    avgIndex: 0,
  };
}

export function isProcessMiningSpan(ev: ToolCallRecord): boolean {
  if (ev.kind === 'prompt') return true;
  if (ev.kind === 'call_tool' || ev.kind === 'tool') return true;
  if (isCapaMetaToolWrapperSpan(ev)) return false;
  return !SKIP_KINDS.has(ev.kind);
}

export function processActivityForSpan(ev: ToolCallRecord): ProcessActivity | null {
  if (ev.kind === 'prompt') {
    return {
      id: PROMPT_NODE_ID,
      toolName: 'Prompt',
      label: 'Prompt',
      avgIndex: 0,
      isStart: true,
    };
  }

  if (!isProcessMiningSpan(ev)) return null;

  if (ev.kind === 'call_tool' || ev.kind === 'tool') {
    const toolName = ev.tool_name?.trim();
    if (!toolName || CAPA_META_TOOL_NAMES.has(toolName)) return null;
    return capaToolActivity(toolName);
  }

  if (isCapaMetaToolWrapperSpan(ev)) return null;

  if (ev.kind === 'shell' || isCommandSpan(ev)) {
    return {
      id: SHELL_NODE_ID,
      toolName: SHELL_NODE_ID,
      label: SHELL_NODE_ID,
      avgIndex: 0,
    };
  }

  if (ev.kind === 'skill') {
    const skillName = skillNameFromSpan(ev);
    return {
      id: `skill:${skillName}`,
      toolName: skillName,
      label: skillName,
      avgIndex: 0,
      isSkill: true,
    };
  }

  if (ev.kind === 'agent_tool' || ev.kind === 'agent_mcp') {
    const raw = ev.tool_name?.trim() ?? '';
    const toolName =
      ev.kind === 'agent_mcp' || /^MCP:/i.test(raw)
        ? nativeMcpToolName(raw)
        : canonicalAgentToolName(raw);
    return { id: toolName, toolName, label: toolName, avgIndex: 0 };
  }

  return null;
}

function runTrace(events: ToolCallRecord[]): ProcessActivity[] {
  const sorted = [...events].sort(
    (a, b) => a.started_at - b.started_at || a.id.localeCompare(b.id),
  );
  const trace: ProcessActivity[] = [];
  for (const ev of sorted) {
    const activity = processActivityForSpan(ev);
    if (activity) trace.push(activity);
  }
  return trace;
}

/**
 * Mine direct-follows edges from ordered activity traces (one trace per run).
 */
export function buildProcessGraph(runs: ActivityRun[]): ProcessGraph {
  const edgeCounts = new Map<string, number>();
  const nodeCounts: Record<string, number> = {};
  const nodeErrorCounts: Record<string, number> = {};
  const positionSum = new Map<string, number>();
  const positionCount = new Map<string, number>();
  const activityById = new Map<string, ProcessActivity>();

  for (const run of runs) {
    const events = [...(run.prompt ? [run.prompt] : []), ...run.spans];
    const sorted = [...events].sort(
      (a, b) => a.started_at - b.started_at || a.id.localeCompare(b.id),
    );

    for (const ev of sorted) {
      const activity = processActivityForSpan(ev);
      if (activity && ev.status === 'error') {
        nodeErrorCounts[activity.id] = (nodeErrorCounts[activity.id] ?? 0) + 1;
      }
    }

    const trace = runTrace(sorted);
    for (let i = 0; i < trace.length; i++) {
      const activity = trace[i]!;
      activityById.set(activity.id, activity);
      nodeCounts[activity.id] = (nodeCounts[activity.id] ?? 0) + 1;
      positionSum.set(activity.id, (positionSum.get(activity.id) ?? 0) + i);
      positionCount.set(activity.id, (positionCount.get(activity.id) ?? 0) + 1);
    }
    for (let i = 0; i < trace.length - 1; i++) {
      const from = trace[i]!.id;
      const to = trace[i + 1]!.id;
      const key = `${from}\t${to}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  const activities: ProcessActivity[] = [...activityById.values()]
    .map((activity) => {
      const count = positionCount.get(activity.id) ?? 1;
      const sum = positionSum.get(activity.id) ?? 0;
      return { ...activity, avgIndex: sum / count };
    })
    .sort((a, b) => {
      if (a.isStart && !b.isStart) return -1;
      if (!a.isStart && b.isStart) return 1;
      return a.avgIndex - b.avgIndex || a.label.localeCompare(b.label);
    });

  const edges: ProcessEdge[] = [...edgeCounts.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('\t') as [string, string];
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));

  return {
    activities,
    edges,
    nodeCounts,
    nodeErrorCounts,
    traceCount: runs.length,
  };
}

function mermaidNodeId(index: number): string {
  return `n${index}`;
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/["\\<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

export type MermaidClassColors = {
  startFill: string;
  startText: string;
  startStroke: string;
  toolFill: string;
  toolText: string;
  toolStroke: string;
  skillFill: string;
  skillText: string;
  skillStroke: string;
  errorFill: string;
  errorText: string;
  errorStroke: string;
  edge: string;
  edgeLabelBg: string;
  edgeLabelText: string;
};

/** Mermaid classDef/linkStyle only accept #hex (quoted values and rgb() fail to parse). */
export function mermaidStyleColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const hex = [rgb[1], rgb[2], rgb[3]]
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('');
    return `#${hex}`;
  }
  return fallback;
}

/** Directly-follows graph as a Mermaid flowchart (top-down). */
export function toMermaidFlowchart(
  graph: ProcessGraph,
  colors: MermaidClassColors,
  errorLabel?: (count: number) => string,
): string {
  const ids = new Map<string, string>();
  graph.activities.forEach((activity, index) => {
    ids.set(activity.id, mermaidNodeId(index));
  });

  const lines: string[] = ['flowchart TD'];

  for (const activity of graph.activities) {
    const id = ids.get(activity.id)!;
    const count = graph.nodeCounts[activity.id] ?? 0;
    const errors = graph.nodeErrorCounts[activity.id] ?? 0;
    const parts = [escapeMermaidLabel(activity.label), String(count)];
    if (errors > 0) {
      parts.push(errorLabel?.(errors) ?? `${errors} err`);
    }
    const label = parts.join('<br/>');
    if (activity.isStart) {
      lines.push(`  ${id}((${escapeMermaidLabel(activity.label)} ${count}))`);
    } else if (activity.isSkill) {
      lines.push(`  ${id}(["${label}"])`);
    } else {
      lines.push(`  ${id}["${label}"]`);
    }
  }

  const maxEdge = Math.max(1, ...graph.edges.map((edge) => edge.count));
  const edgeColor = mermaidStyleColor(colors.edge, '#818cf8');
  graph.edges.forEach((edge, index) => {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (!from || !to) return;
    lines.push(`  ${from} -->|${edge.count}| ${to}`);
    const width = (1.5 + (edge.count / maxEdge) * 3).toFixed(1);
    lines.push(`  linkStyle ${index} stroke:${edgeColor},stroke-width:${width}px`);
  });

  for (const activity of graph.activities) {
    const id = ids.get(activity.id)!;
    const errors = graph.nodeErrorCounts[activity.id] ?? 0;
    const cls = errors > 0
      ? 'fail'
      : activity.isStart
        ? 'start'
        : activity.isSkill
          ? 'skill'
          : 'tool';
    lines.push(`  class ${id} ${cls}`);
  }

  lines.push(
    `  classDef start fill:${mermaidStyleColor(colors.startFill, '#34d399')},color:${mermaidStyleColor(colors.startText, '#0f1120')},stroke:${mermaidStyleColor(colors.startStroke, '#34d399')}`,
    `  classDef tool fill:${mermaidStyleColor(colors.toolFill, '#818cf8')},color:${mermaidStyleColor(colors.toolText, '#0f1120')},stroke:${mermaidStyleColor(colors.toolStroke, '#a5b4fc')}`,
    `  classDef skill fill:${mermaidStyleColor(colors.skillFill, '#1a1540')},color:${mermaidStyleColor(colors.skillText, '#818cf8')},stroke:${mermaidStyleColor(colors.skillStroke, '#1e2036')}`,
    `  classDef fail fill:${mermaidStyleColor(colors.errorFill, '#2d1215')},color:${mermaidStyleColor(colors.errorText, '#f87171')},stroke:${mermaidStyleColor(colors.errorStroke, '#1e2036')}`,
  );

  return lines.join('\n');
}

/** Markdown export for the process diagram (Mermaid block when available). */
export function graphToMarkdown(graph: ProcessGraph, mermaid?: string | null): string {
  const lines = ['# Process analysis', ''];
  if (mermaid?.trim()) {
    lines.push('```mermaid', mermaid.trim(), '```');
    return lines.join('\n');
  }
  for (const activity of graph.activities) {
    const count = graph.nodeCounts[activity.id] ?? 0;
    lines.push(`- ${activity.label} (${count} occurrence${count === 1 ? '' : 's'})`);
  }
  if (graph.edges.length > 0) {
    lines.push('', '## Transitions', '');
    for (const edge of graph.edges) {
      const from = graph.activities.find((a) => a.id === edge.from)?.label ?? edge.from;
      const to = graph.activities.find((a) => a.id === edge.to)?.label ?? edge.to;
      lines.push(`- ${from} → ${to} (${edge.count}×)`);
    }
  }
  return lines.join('\n');
}
