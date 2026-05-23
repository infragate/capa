import { intro as clackIntro, outro as clackOutro, log as clackLog } from '@clack/prompts'
import { c, icon } from './colors'
import { isInteractive, isJson, isQuiet, isVerbose } from './flags'

export function header(title: string): void {
  if (isJson() || isQuiet()) return
  clackIntro(c.bold(title))
}

export function footer(message: string): void {
  if (isJson() || isQuiet()) return
  clackOutro(message)
}

export function success(message: string): void {
  if (isJson()) {
    process.stdout.write(JSON.stringify({ level: 'success', message }) + '\n')
    return
  }
  if (isQuiet()) return
  clackLog.success(message)
}

export function info(message: string): void {
  if (isJson()) {
    process.stdout.write(JSON.stringify({ level: 'info', message }) + '\n')
    return
  }
  if (isQuiet()) return
  clackLog.info(message)
}

export function warn(message: string): void {
  if (isJson()) {
    process.stdout.write(JSON.stringify({ level: 'warn', message }) + '\n')
    return
  }
  clackLog.warn(message)
}

export function error(message: string): void {
  if (isJson()) {
    process.stderr.write(JSON.stringify({ level: 'error', message }) + '\n')
    return
  }
  clackLog.error(message)
}

export interface Summary {
  added?: number
  failed?: number
  skipped?: number
  elapsedMs?: number
}

// Per-step detail lines (e.g. "✓ rule X written") that are suppressed when
// the live spinner owns the screen and printed verbatim elsewhere.
export function taskLog(message: string): void {
  if (isJson()) {
    process.stdout.write(JSON.stringify({ level: 'info', message }) + '\n')
    return
  }
  if (isQuiet()) return
  const ownedBySpinner = isInteractive() && !isVerbose() && !process.env.CI
  if (ownedBySpinner) return
  console.log(message)
}

export function summary(s: Summary): void {
  if (isJson()) {
    process.stdout.write(JSON.stringify({ level: 'summary', ...s }) + '\n')
    return
  }
  if (isQuiet()) return
  const parts: string[] = []
  if (s.added !== undefined) parts.push(`${s.added} added`)
  if (s.failed !== undefined && s.failed > 0) parts.push(c.error(`${s.failed} failed`))
  if (s.skipped !== undefined && s.skipped > 0) parts.push(`${s.skipped} skipped`)
  const elapsed = s.elapsedMs !== undefined ? ` in ${(s.elapsedMs / 1000).toFixed(1)}s` : ''
  clackLog.message(`${icon.success()} Done${elapsed}${parts.length ? ` · ${parts.join(' · ')}` : ''}`)
}
