import pc from 'picocolors'
import { isColorEnabled } from './flags'

function wrap(fn: (s: string) => string) {
  return (s: string) => (isColorEnabled() ? fn(s) : s)
}

export const c = {
  bold: wrap(pc.bold),
  dim: wrap(pc.dim),
  italic: wrap(pc.italic),
  underline: wrap(pc.underline),
  red: wrap(pc.red),
  green: wrap(pc.green),
  yellow: wrap(pc.yellow),
  blue: wrap(pc.blue),
  magenta: wrap(pc.magenta),
  cyan: wrap(pc.cyan),
  gray: wrap(pc.gray),
  white: wrap(pc.white),
  success: wrap(pc.green),
  info: wrap(pc.cyan),
  warn: wrap(pc.yellow),
  error: wrap(pc.red),
  muted: wrap(pc.dim),
}

export const icon = {
  success: () => c.success('✓'),
  error: () => c.error('✗'),
  warning: () => c.warn('!'),
  info: () => c.info('›'),
  pending: () => c.muted('·'),
}
