/**
 * Simple but elegant logger with colors and structured formatting
 */

import { format } from 'util';
import pc from 'picocolors';
import { isColorEnabled } from './tty';

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

interface LogSink {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

function colorize(colorFn: (s: string) => string, value: string): string {
  return isColorEnabled() ? colorFn(value) : value;
}

function parseLogLevel(value: string | undefined): LogLevel {
  switch (value?.toUpperCase()) {
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

class Logger {
  private level: LogLevel;
  private prefix: string;
  private stdout: NodeJS.WritableStream = process.stdout;
  private stderr: NodeJS.WritableStream = process.stderr;

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
   * Override stdout/stderr sinks (for tests or custom output)
   */
  setSink(sink: LogSink): void {
    if (sink.stdout !== undefined) this.stdout = sink.stdout;
    if (sink.stderr !== undefined) this.stderr = sink.stderr;
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

  private formatLine(message: string, ...args: unknown[]): string {
    return args.length > 0 ? format(message, ...args) : message;
  }

  private writeOut(stream: NodeJS.WritableStream, message: string, ...args: unknown[]): void {
    stream.write(this.formatLine(message, ...args) + '\n');
  }

  /**
   * Format prefix with colors
   */
  private formatPrefix(levelName: string, colorFn: (s: string) => string): string {
    const ts = colorize(pc.gray, this.timestamp());
    const prefix = this.prefix ? ` [${this.prefix}]` : '';
    const level = colorize(colorFn, levelName);
    return `${ts} ${level}${prefix}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      const prefix = this.formatPrefix('DEBUG', pc.cyan);
      this.writeOut(this.stdout, `${prefix} ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      const prefix = this.formatPrefix('INFO ', pc.green);
      this.writeOut(this.stdout, `${prefix} ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      const prefix = this.formatPrefix('WARN ', pc.yellow);
      this.writeOut(this.stderr, `${prefix} ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      const prefix = this.formatPrefix('ERROR', pc.red);
      this.writeOut(this.stderr, `${prefix} ${message}`, ...args);
    }
  }

  /**
   * Log with a symbol (✓, ✗, ℹ, etc.)
   */
  success(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      const prefix = this.formatPrefix('INFO ', pc.green);
      const mark = colorize(pc.green, '✓');
      this.writeOut(this.stdout, `${prefix} ${mark} ${message}`, ...args);
    }
  }

  failure(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      const prefix = this.formatPrefix('ERROR', pc.red);
      const mark = colorize(pc.red, '✗');
      this.writeOut(this.stderr, `${prefix} ${mark} ${message}`, ...args);
    }
  }

  /**
   * Log HTTP request
   */
  http(method: string, path: string, status?: number): void {
    if (this.level <= LogLevel.INFO) {
      const ts = colorize(pc.gray, this.timestamp());
      const label = colorize(pc.magenta, 'HTTP ');
      const statusStr = status ? ` ${status}` : '';
      const statusPart = status
        ? colorize(status >= 400 ? pc.red : pc.green, statusStr)
        : statusStr;
      this.stdout.write(`${ts} ${label} ${method} ${path}${statusPart}\n`);
    }
  }

  /**
   * Log raw message without formatting
   */
  raw(message: string): void {
    if (this.level <= LogLevel.INFO) {
      this.stdout.write(message + '\n');
    }
  }
}

// Default logger instance
export const logger = new Logger();
logger.setLevel(parseLogLevel(process.env.CAPA_LOG_LEVEL));
