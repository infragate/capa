import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function stripFrontmatter(md: string): string {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

export function renderMarkdown(md: string): string {
  const raw = marked.parse(stripFrontmatter(md), { async: false, gfm: true, breaks: true }) as string;
  // Previews include third-party registry text and are injected inline, so
  // also drop restyling and form elements DOMPurify allows by default.
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe'],
    FORBID_ATTR: ['style'],
  });
}
