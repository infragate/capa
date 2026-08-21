import { describe, it, expect, afterEach } from 'bun:test';
import { getFlags, isHeadless, setFlags } from '../flags';

describe('cli flags', () => {
  afterEach(() => {
    setFlags({
      json: false,
      quiet: false,
      verbose: false,
      noColor: false,
      yes: false,
      headless: false,
    });
  });

  it('isHeadless reflects --headless', () => {
    expect(isHeadless()).toBe(false);
    setFlags({ headless: true });
    expect(isHeadless()).toBe(true);
    expect(getFlags().headless).toBe(true);
  });
});
