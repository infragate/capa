import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export function projectDisplayName(path: string | null | undefined, fallback?: string): string {
  if (!path) return fallback || 'Unknown';
  const parts = path.replace(/[/\\]$/, '').split(/[/\\]/);
  return parts.filter(Boolean).pop() || fallback || 'Unknown';
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  const v = Math.floor(n);
  if (v >= 1_000_000) {
    return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (v >= 1000) {
    return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return String(v);
}

export function highlightText(text: string, query: string): string {
  if (!text) return '';
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(
    new RegExp(escapedQuery, 'gi'),
    (m) => `<span class="search-highlight">${m}</span>`,
  );
}

export function matchesSearch(texts: (string | null | undefined)[], query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return texts.some((t) => t != null && t.toLowerCase().includes(q));
}

/** True when Space/Enter should type into a field, not activate a parent role=button. */
export function isFormFieldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

const BADGE_HUES = [
  0, 20, 40, 55, 80, 120, 155, 175, 195, 210,
  230, 250, 270, 290, 310, 330, 345, 15, 165, 50,
];

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getServerHue(serverId: string): number {
  return BADGE_HUES[hashString(serverId) % BADGE_HUES.length];
}
