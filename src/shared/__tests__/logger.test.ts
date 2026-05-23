import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { logger, LogLevel } from '../logger';

const ANSI_RE = /\x1b\[[0-9;]*m/;

describe('logger', () => {
  let captured: string[];

  const mockStream = {
    write(chunk: string) {
      captured.push(chunk);
      return true;
    },
  } as NodeJS.WritableStream;

  beforeEach(() => {
    captured = [];
    logger.setLevel(LogLevel.INFO);
    logger.setSink({ stdout: mockStream, stderr: mockStream });
  });

  afterEach(() => {
    logger.setSink({ stdout: process.stdout, stderr: process.stderr });
    logger.setLevel(LogLevel.INFO);
    delete process.env.NO_COLOR;
  });

  it('setLevel(DEBUG) enables debug output', () => {
    logger.debug('hidden at INFO');
    expect(captured).toHaveLength(0);

    logger.setLevel(LogLevel.DEBUG);
    logger.debug('visible at DEBUG');
    expect(captured.join('')).toContain('visible at DEBUG');
  });

  it('setLevel(SILENT) suppresses all output', () => {
    logger.setLevel(LogLevel.SILENT);
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(captured).toHaveLength(0);
  });

  it('setSink({ stdout }) captures output', () => {
    logger.info('hello sink');
    expect(captured.join('')).toContain('hello sink');
  });

  it('with NO_COLOR=1 output contains no ANSI escapes', () => {
    process.env.NO_COLOR = '1';
    logger.info('plain text');
    const output = captured.join('');
    expect(output).toContain('plain text');
    expect(output).not.toMatch(ANSI_RE);
  });
});
