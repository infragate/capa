import { isColorEnabled as isEnvColorEnabled } from '../../shared/tty'

// Global flag state captured once at program-startup.
// Lives in this module so the rest of the UI helpers can read it without prop-drilling.

export interface CliFlags {
  json: boolean
  quiet: boolean
  verbose: boolean
  noColor: boolean
  yes: boolean
  headless: boolean
}

let currentFlags: CliFlags = {
  json: false,
  quiet: false,
  verbose: false,
  noColor: false,
  yes: false,
  headless: false,
}

export function setFlags(flags: Partial<CliFlags>): void {
  currentFlags = { ...currentFlags, ...flags }
  // Honour NO_COLOR / CI env if --no-color wasn't already passed
  if (process.env.NO_COLOR || process.env.CI) {
    currentFlags.noColor = true
  }
}

export function getFlags(): Readonly<CliFlags> {
  return currentFlags
}

export function isColorEnabled(): boolean {
  if (currentFlags.noColor) return false
  return isEnvColorEnabled()
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)
}

export function isJson(): boolean {
  return currentFlags.json
}

export function isQuiet(): boolean {
  return currentFlags.quiet
}

export function isVerbose(): boolean {
  return currentFlags.verbose
}

export function isYes(): boolean {
  return currentFlags.yes
}

/**
 * True when the user asked CAPA to treat this as a headless environment via
 * `--headless`. In headless mode, steps that would launch a desktop browser
 * (OAuth / credential setup) print the URL instead, so CAPA never blocks
 * waiting on a browser that no one can see — e.g. in CI or a cloud agent
 * sandbox.
 */
export function isHeadless(): boolean {
  return currentFlags.headless
}
