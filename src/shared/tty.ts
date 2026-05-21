/** Environment-level TTY / color gate (no CLI flag overrides). */
export function isColorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.CI) return false;
  return Boolean(process.stdout.isTTY);
}
