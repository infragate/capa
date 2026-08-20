import type { ToolCallRecord } from '../../../../types/api';

export type RunCommandEntry = {
  id: string;
  command: string;
  toolName: string;
};

const SHELL_TOOL_NAMES = new Set([
  'Shell',
  'Bash',
  'run_shell_command',
  'shell',
  'RunTerminalCommand',
  'terminal',
]);

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

export function isCommandSpan(call: ToolCallRecord): boolean {
  if (call.kind === 'shell') return true;
  if (call.kind === 'agent_tool' && SHELL_TOOL_NAMES.has(call.tool_name)) return true;
  return false;
}

export function extractCommandFromSpan(call: ToolCallRecord): string | null {
  const args = parseArgs(call.args_json);
  if (args) {
    for (const key of ['command', 'cmd', 'script']) {
      const v = args[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  if (call.tool_name && call.kind === 'shell') {
    return call.tool_name.trim() || null;
  }
  return null;
}

export function collectRunCommands(events: ToolCallRecord[]): RunCommandEntry[] {
  const out: RunCommandEntry[] = [];
  for (const ev of events) {
    if (!isCommandSpan(ev)) continue;
    const command = extractCommandFromSpan(ev);
    if (!command) continue;
    out.push({ id: ev.id, command, toolName: ev.tool_name });
  }
  return out;
}

export function filterRunCommands(
  entries: RunCommandEntry[],
  search: string,
): RunCommandEntry[] {
  const q = search.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.command.toLowerCase().includes(q) ||
      e.toolName.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q),
  );
}

export function runCommandsExportText(entries: RunCommandEntry[]): string {
  return entries.map((e) => e.command).join('\n');
}
