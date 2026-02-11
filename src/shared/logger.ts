/**
 * Simple but elegant logger with colors and structured formatting
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.prefix = options.prefix ?? '';
  }

  /**
   * Create a child logger with a prefix
   */
  child(prefix: string): Logger {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger({ level: this.level, prefix: childPrefix });
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Format timestamp
   */
  private timestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
  }

  /**
   * Format prefix with colors
   */
  private formatPrefix(levelName: string, color: string): string {
    const ts = this.timestamp();
    const prefix = this.prefix ? ` [${this.prefix}]` : '';
    return `\x1b[90m${ts}\x1b[0m ${color}${levelName}\x1b[0m${prefix}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      const prefix = this.formatPrefix('DEBUG', '\x1b[36m'); // Cyan
      console.log(`${prefix} ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      const prefix = this.formatPrefix('INFO ', '\x1b[32m'); // Green
      console.log(`${prefix} ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      const prefix = this.formatPrefix('WARN ', '\x1b[33m'); // Yellow
      console.warn(`${prefix} ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      const prefix = this.formatPrefix('ERROR', '\x1b[31m'); // Red
      console.error(`${prefix} ${message}`, ...args);
    }
  }

  /**
   * Log with a symbol (✓, ✗, ℹ, etc.)
   */
  success(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      const prefix = this.formatPrefix('INFO ', '\x1b[32m');
      console.log(`${prefix} \x1b[32m✓\x1b[0m ${message}`, ...args);
    }
  }

  failure(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      const prefix = this.formatPrefix('ERROR', '\x1b[31m');
      console.error(`${prefix} \x1b[31m✗\x1b[0m ${message}`, ...args);
    }
  }

  /**
   * Log HTTP request
   */
  http(method: string, path: string, status?: number): void {
    if (this.level <= LogLevel.INFO) {
      const ts = this.timestamp();
      const statusStr = status ? ` ${status}` : '';
      const statusColor = status && status >= 400 ? '\x1b[31m' : '\x1b[32m';
      console.log(`\x1b[90m${ts}\x1b[0m \x1b[35mHTTP \x1b[0m ${method} ${path}${statusColor}${statusStr}\x1b[0m`);
    }
  }

  /**
   * Log raw message without formatting
   */
  raw(message: string): void {
    if (this.level <= LogLevel.INFO) {
      console.log(message);
    }
  }
}

// Default logger instance
export const logger = new Logger();

// Helper to get log level from environment
export function getLogLevelFromEnv(): LogLevel {
  const level = process.env.LOG_LEVEL?.toUpperCase();
  switch (level) {
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    case 'SILENT':
      return LogLevel.SILENT;
    default:
      return LogLevel.INFO;
  }
}
