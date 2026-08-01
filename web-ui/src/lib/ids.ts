/** YAML / capa entry ids: letter or underscore first, then alnum / - / _ */
export const CAPA_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function isValidCapaId(id: string): boolean {
  return CAPA_ID_PATTERN.test(id);
}

/** Strip characters that are never legal in a capa id (keeps typing fluid). */
export function sanitizeCapaIdInput(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * Returns an error message key suffix or null if valid.
 * - empty
 * - invalidStart
 * - invalidChars
 */
export type CapaIdIssue = 'empty' | 'invalidStart' | 'invalidChars';

export function capaIdIssue(id: string): CapaIdIssue | null {
  const trimmed = id.trim();
  if (!trimmed) return 'empty';
  if (!/^[A-Za-z_]/.test(trimmed)) return 'invalidStart';
  if (!CAPA_ID_PATTERN.test(trimmed)) return 'invalidChars';
  return null;
}

/** Localized validation message for capa entry ids, or null when valid. */
export function capaIdErrorMessage(id: string, t: (key: string) => string): string | null {
  const issue = capaIdIssue(id);
  if (!issue) return null;
  if (issue === 'empty') return t('actions.idInvalidEmpty');
  if (issue === 'invalidStart') return t('actions.idInvalidStart');
  return t('actions.idInvalidChars');
}
