import { describe, it, expect } from 'bun:test';
import { toCanonicalOrScopedHookOn } from '../provider-map';

describe('toCanonicalOrScopedHookOn', () => {
  it('maps Claude SessionStart to canonical sessionStart', () => {
    expect(toCanonicalOrScopedHookOn('claude-code', 'SessionStart')).toBe('sessionStart');
  });

  it('keeps Cursor sessionStart as canonical', () => {
    expect(toCanonicalOrScopedHookOn('cursor', 'sessionStart')).toBe('sessionStart');
  });

  it('maps Claude PreToolUse without matcher to beforeTool', () => {
    expect(toCanonicalOrScopedHookOn('claude-code', 'PreToolUse')).toBe('beforeTool');
  });

  it('narrows Claude PreToolUse + Bash matcher to beforeShell', () => {
    expect(toCanonicalOrScopedHookOn('claude-code', 'PreToolUse', 'Bash')).toBe(
      'beforeShell',
    );
  });

  it('falls back to provider-scoped for unmapped events', () => {
    expect(toCanonicalOrScopedHookOn('claude-code', 'Notification')).toBe(
      'claude-code:Notification',
    );
  });
});
