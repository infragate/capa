const MARKER_START = (id: string) => `<!-- capa:start:${id} -->`;
const MARKER_END = (id: string) => `<!-- capa:end:${id} -->`;

/** Match a well-formed capa block; end marker id must match the start id. */
const blockPattern = (id: string) => {
  const escapedId = escapeRegex(id);
  return new RegExp(
    `<!-- capa:start:(${escapedId}) -->[\\s\\S]*?<!-- capa:end:\\1 -->`,
    'g',
  );
};

const ANY_BLOCK_PATTERN =
  /<!-- capa:start:([^>]+?) -->[\s\S]*?<!-- capa:end:\1 -->/g;

/** Unwrap a well-formed capa block, keeping only its inner body. */
const CAPA_BLOCK_WITH_BODY =
  /<!-- capa:start:([^>]+?) -->\n?([\s\S]*?)<!-- capa:end:\1 -->/g;

const ORPHAN_MARKER_PATTERN = /<!-- capa:(?:start|end):[^>]+ -->\n?/g;

/** Snippet ids owned by `agents.base` / `agents.additional` (not rules or sub-agents). */
export function isAgentInstructionSnippetId(id: string): boolean {
  if (id === '__base__') return true;
  return !id.startsWith('rule:') && !id.startsWith('sub-agent:');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildBlock(id: string, body: string): string {
  const trimmed = body.trimEnd();
  return `${MARKER_START(id)}\n${trimmed}\n${MARKER_END(id)}`;
}

export function upsertSnippet(content: string, id: string, body: string): string {
  const block = buildBlock(id, body);
  const pattern = blockPattern(id);
  if (pattern.test(content)) {
    // Fresh RegExp — `.test()` advances `lastIndex` on the `g` flag instance.
    return content.replace(blockPattern(id), block);
  }
  const base = content.trimEnd();
  return base.length > 0 ? `${base}\n\n${block}\n` : `${block}\n`;
}

export function removeSnippet(content: string, id: string): string {
  return content.replace(blockPattern(id), '').replace(/\n{3,}/g, '\n\n');
}

export function removeAllCapaSnippets(content: string): string {
  return content.replace(ANY_BLOCK_PATTERN, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Drop stray capa marker lines left by partial edits or corrupted upserts. */
export function stripOrphanCapaMarkers(content: string): string {
  return content.replace(ORPHAN_MARKER_PATTERN, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Remove every capa marker block (well-formed or orphan), preserving other content.
 * Used before re-inserting the desired snippet set so sync is idempotent.
 */
export function clearCapaSnippetMarkers(content: string): string {
  return stripOrphanCapaMarkers(removeAllCapaSnippets(content));
}

/**
 * Strip capa marker scaffolding from a source file or inline snippet body before
 * capa wraps it in its own blocks. Unwraps well-formed blocks (keeps inner text),
 * then drops orphan start/end lines left by partial edits.
 */
export function sanitizeAgentSourceContent(content: string): string {
  const unwrapped = content.replace(
    CAPA_BLOCK_WITH_BODY,
    (_match, _id: string, body: string) => body.trimEnd(),
  );
  return stripOrphanCapaMarkers(unwrapped).trimStart();
}

/** Remove only agent-instruction blocks; leave rule / sub-agent marker blocks intact. */
export function clearAgentInstructionSnippets(content: string): string {
  let result = content;
  for (const id of listCapaSnippetIds(content)) {
    if (isAgentInstructionSnippetId(id)) {
      result = removeSnippet(result, id);
    }
  }
  return stripOrphanAgentMarkers(result).replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Drop orphan start/end lines for agent instruction ids (e.g. stale `<!-- capa:end:__base__ -->`). */
export function stripOrphanAgentMarkers(content: string): string {
  return content
    .replace(
      /^<!-- capa:(?:start|end):(?!rule:|sub-agent:)[^>]+ -->\n?/gm,
      '',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

/**
 * Full re-render of agent instruction snippets: strip all agent-owned blocks,
 * then write the desired set in order. Non-capa content and rule/sub-agent
 * blocks are preserved.
 */
export function renderAgentInstructionSnippets(
  content: string,
  snippets: Array<{ id: string; body: string }>,
): string {
  const prefix = clearAgentInstructionSnippets(content);
  if (snippets.length === 0) {
    return prefix.length > 0 ? `${prefix}\n` : '';
  }
  const blocks = snippets.map(({ id, body }) => buildBlock(id, body));
  const rendered = blocks.join('\n\n');
  return prefix.length > 0 ? `${prefix}\n\n${rendered}\n` : `${rendered}\n`;
}

export function listCapaSnippetIds(content: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  const re = /<!-- capa:start:([^>]+?) -->/g;
  while ((match = re.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

/** True when the file contains capa-managed agent instruction blocks or stray agent markers. */
export function fileHasManagedAgentInstructions(content: string): boolean {
  if (!content.trim()) return false;
  for (const id of listCapaSnippetIds(content)) {
    if (isAgentInstructionSnippetId(id)) return true;
  }
  return /^<!-- capa:(?:start|end):(?!rule:|sub-agent:)/m.test(content);
}

/** True when capa already owns part of this instructions file (agents, rules, or sub-agents). */
export function fileHasCapaInstructionsMarkers(content: string): boolean {
  if (!content.trim()) return false;
  if (listCapaSnippetIds(content).length > 0) return true;
  return /^<!-- capa:(?:start|end):/m.test(content);
}
