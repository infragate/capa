import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function stripFrontmatter(md: string): string {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

export function renderMarkdown(md: string): string {
  const raw = marked.parse(stripFrontmatter(md), { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw);
}
