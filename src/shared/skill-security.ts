import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import type { SecurityOptions } from '../types/capabilities';

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

/**
 * Error thrown when a blocked phrase is detected in a skill during installation.
 */
export class BlockedPhraseError extends Error {
  constructor(
    message: string,
    public readonly skillId: string,
    public readonly filePath: string,
    public readonly phrase: string,
    public readonly pluginName?: string
  ) {
    super(message);
    this.name = 'BlockedPhraseError';
  }
}

/**
 * Output a blocked phrase error in red and exit the process.
 */
export function reportBlockedPhraseAndExit(
  skillId: string,
  filePath: string,
  phrase: string,
  pluginName?: string
): never {
  const location = pluginName
    ? `Skill "${skillId}" in plugin "${pluginName}"`
    : `Skill "${skillId}"`;
  const msg =
    `\n${RED}✗ Installation blocked: forbidden phrase detected${RESET}\n\n` +
    `  ${RED}${location}${RESET}\n` +
    `  File: ${filePath}\n` +
    `  Forbidden phrase: ${RED}"${phrase}"${RESET}\n\n` +
    `  Installation has been stopped. Remove the phrase from the skill or update\n` +
    `  your security configuration (options.security.blockedPhrases) and try again.\n`;
  console.error(msg);
  process.exit(1);
}

/**
 * Characters that are always preserved regardless of the user's allowedCharacters setting.
 * Covers standard whitespace (tab, LF, CR) and all printable ASCII (space U+0020 through tilde U+007E).
 * This guarantees that skill markdown structure (-, :, ", ', newlines, symbols) is never stripped.
 */
const BASELINE_ALLOWED_INNER = '\\t\\n\\r\\x20-\\x7E';
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.html', '.css', '.xml'
]);

/**
 * Check if a filename has a text extension (for security checks and sanitization)
 */
export function isTextFile(filename: string): boolean {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  return TEXT_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Load blocked phrases from security options.
 * Returns empty array if no security config or no blocked phrases.
 * @param security - Security options from capabilities
 * @param capabilitiesFilePath - Full path to capabilities file (for resolving relative file paths)
 */
export function loadBlockedPhrases(
  security: SecurityOptions | undefined,
  capabilitiesFilePath: string
): string[] {
  const blocked = security?.blockedPhrases;
  if (blocked === undefined) return [];

  if (Array.isArray(blocked)) {
    return blocked
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  if (typeof blocked === 'object' && blocked !== null && 'file' in blocked && typeof blocked.file === 'string') {
    const capabilitiesDir = dirname(capabilitiesFilePath);
    const filePath = resolve(capabilitiesDir, blocked.file);
    if (!existsSync(filePath)) {
      throw new Error(
        `Blocked phrases file not found: ${filePath}\n` +
        `  Resolved from: ${blocked.file} (relative to ${capabilitiesDir})`
      );
    }
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  return [];
}

/**
 * Check if content contains any blocked phrase (case-sensitive).
 */
export function checkBlockedPhrases(
  content: string,
  phrases: string[]
): { blocked: boolean; phrase?: string } {
  if (phrases.length === 0) return { blocked: false };

  for (const phrase of phrases) {
    if (content.includes(phrase)) {
      return { blocked: true, phrase };
    }
  }
  return { blocked: false };
}

/**
 * Sanitize content by replacing disallowed characters with a space.
 *
 * The baseline (tab, LF, CR, all printable ASCII U+0020–U+007E) is ALWAYS preserved,
 * regardless of what allowedCharacters specifies. allowedCharacters is treated as an
 * ADDITIONAL allow-list on top of the baseline — users can permit extra Unicode ranges
 * but can never restrict below printable ASCII.
 *
 * @param content - Content to sanitize
 * @param allowedCharacters - Extra regex character class content to allow beyond the baseline.
 *   May include surrounding brackets (e.g. `[\\u00A0-\\uFFFF]`) or just the inner content.
 *   Pass an empty string to apply baseline-only sanitization (strip all non-ASCII Unicode).
 */
export function sanitizeContent(content: string, allowedCharacters: string): string {
  let userInner = allowedCharacters.trim();
  if (userInner.startsWith('[') && userInner.endsWith(']')) {
    userInner = userInner.slice(1, -1);
  }

  // Combine baseline with user's extra allowances. The baseline ensures that printable
  // ASCII and standard whitespace are never stripped, regardless of user configuration.
  const combined = BASELINE_ALLOWED_INNER + userInner;

  try {
    const regex = new RegExp(`[^${combined}]`, 'g');
    return content.replace(regex, ' ');
  } catch {
    // Invalid user-provided regex — fall back to baseline only
    const fallback = new RegExp(`[^${BASELINE_ALLOWED_INNER}]`, 'g');
    return content.replace(fallback, ' ');
  }
}

/**
 * Check if blocked phrases feature is enabled (property must be present).
 * Omit or comment out blockedPhrases to disable.
 */
export function isBlockedPhrasesEnabled(security: SecurityOptions | undefined): boolean {
  if (!security) return false;
  return security.blockedPhrases !== undefined;
}

/**
 * Check if character sanitization is enabled (property must be present).
 * Omit or comment out allowedCharacters to disable.
 */
export function isCharacterSanitizationEnabled(security: SecurityOptions | undefined): boolean {
  if (!security) return false;
  return security.allowedCharacters !== undefined;
}

/**
 * Get the allowed characters value from security options.
 * Returns null when character sanitization is disabled (allowedCharacters omitted/malformed).
 * An empty string is valid and means "baseline-only" sanitization (strip non-ASCII Unicode).
 */
export function getAllowedCharacters(security: SecurityOptions | undefined): string | null {
  const chars = security?.allowedCharacters;
  if (chars === undefined) return null;
  if (typeof chars !== 'string') return null;
  return chars;
}
