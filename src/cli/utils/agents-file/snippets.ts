const MARKER_START = (id: string) => `<!-- capa:start:${id} -->`;
const MARKER_END = (id: string) => `<!-- capa:end:${id} -->`;

const blockPattern = (id: string) =>
  new RegExp(
    `${escapeRegex(MARKER_START(id))}[\\s\\S]*?${escapeRegex(MARKER_END(id))}`,
    'g'
  );

const ANY_BLOCK_PATTERN =
  /<!-- capa:start:([^>]+?) -->[\s\S]*?<!-- capa:end:\1 -->/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildBlock(id: string, body: string): string {
  const trimmed = body.trimEnd();
  return `${MARKER_START(id)}\n${trimmed}\n${MARKER_END(id)}`;
}

export function upsertSnippet(content: string, id: string, body: string): string {
  const block = buildBlock(id, body);
  if (blockPattern(id).test(content)) {
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

export function listCapaSnippetIds(content: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  const re = /<!-- capa:start:([^>]+?) -->/g;
  while ((match = re.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}
