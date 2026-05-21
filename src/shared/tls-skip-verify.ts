import { logger } from './logger';

const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const disabledWarned = new Set<string>();
const activeWarned = new Set<string>();

export function shouldSkipTlsVerify(requested: boolean, context: string): boolean {
  if (!requested) {
    return false;
  }

  const allowed = process.env.CAPA_ALLOW_TLS_SKIP_VERIFY === '1';

  if (!allowed) {
    if (!disabledWarned.has(context)) {
      disabledWarned.add(context);
      logger.warn(
        'tlsSkipVerify requested but disabled — set CAPA_ALLOW_TLS_SKIP_VERIFY=1 to override (insecure)'
      );
    }
    return false;
  }

  if (!activeWarned.has(context)) {
    activeWarned.add(context);
    logger.warn(
      `${RED}${BOLD}!! TLS certificate validation DISABLED for ${context} (CAPA_ALLOW_TLS_SKIP_VERIFY=1)${RESET}`
    );
  }
  return true;
}
