import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isColorEnabled } from '../tty';

describe('isColorEnabled', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let savedIsTTY: boolean | undefined;

  beforeEach(() => {
    savedEnv.NO_COLOR = process.env.NO_COLOR;
    savedEnv.CI = process.env.CI;
    delete process.env.NO_COLOR;
    delete process.env.CI;
    savedIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;
  });

  afterEach(() => {
    if (savedEnv.NO_COLOR === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = savedEnv.NO_COLOR;
    }
    if (savedEnv.CI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = savedEnv.CI;
    }
    if (savedIsTTY === undefined) {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    } else {
      process.stdout.isTTY = savedIsTTY;
    }
  });

  it('returns false when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    expect(isColorEnabled()).toBe(false);
  });

  it('returns false when CI is set', () => {
    process.env.CI = 'true';
    expect(isColorEnabled()).toBe(false);
  });

  it('returns true when stdout is a TTY and no disabling env vars are set', () => {
    expect(isColorEnabled()).toBe(true);
  });
});
