// Browser-safe provider display-name lookup.
// Mirrors `displayName` values from `src/shared/providers/registry.ts` without the
// Node-specific imports (homedir, fs, xdg-basedir) that prevent that module from
// running in the browser.
//
// Keep this in sync when adding a new provider to the registry. See issue #G5.

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  amp: 'Amp',
  antigravity: 'Antigravity',
  augment: 'Augment',
  'claude-code': 'Claude Code',
  claude: 'Claude Code',
  openclaw: 'OpenClaw',
  cline: 'Cline',
  codebuddy: 'CodeBuddy',
  codex: 'Codex',
  'command-code': 'Command Code',
  continue: 'Continue',
  crush: 'Crush',
  cursor: 'Cursor',
  droid: 'Droid',
  'gemini-cli': 'Gemini CLI',
  'github-copilot': 'GitHub Copilot',
  copilot: 'GitHub Copilot',
  goose: 'Goose',
  junie: 'Junie',
  'iflow-cli': 'iFlow CLI',
  kilo: 'Kilo Code',
  'kimi-cli': 'Kimi Code CLI',
  'kiro-cli': 'Kiro CLI',
  kode: 'Kode',
  mcpjam: 'MCPJam',
  'mistral-vibe': 'Mistral Vibe',
  mux: 'Mux',
  opencode: 'OpenCode',
  openhands: 'OpenHands',
  pi: 'Pi',
  qoder: 'Qoder',
  'qwen-code': 'Qwen Code',
  replit: 'Replit',
  roo: 'Roo Code',
  trae: 'Trae',
  'trae-cn': 'Trae CN',
  windsurf: 'Windsurf',
  zencoder: 'Zencoder',
  neovate: 'Neovate',
  pochi: 'Pochi',
  adal: 'AdaL',
};

/**
 * Resolve a provider id to its human-readable display name.
 * Falls back to the raw id if unknown so the UI never shows an empty string.
 */
export function getProviderDisplayName(id: string | null | undefined): string {
  if (!id) return '';
  return PROVIDER_DISPLAY_NAMES[id.toLowerCase()] ?? id;
}
