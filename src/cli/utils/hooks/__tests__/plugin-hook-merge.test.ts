import { describe, it, expect } from 'bun:test';
import type { Hook } from '../../../../types/hooks';
import {
  coalescePluginHook,
  matchersCompatible,
  normalizeHookBodyForDedupe,
  pluginHookMergeKey,
} from '../plugin-hook-merge';

describe('normalizeHookBodyForDedupe', () => {
  it('equates quoted Claude rewrite with unquoted Cursor rewrite', () => {
    const claude =
      '"C:/Users/me/.capa/plugins/p/superpowers/hooks/run-hook.cmd" session-start';
    const cursor =
      'C:/Users/me/.capa/plugins/p/superpowers/hooks/run-hook.cmd session-start';
    expect(normalizeHookBodyForDedupe(claude)).toBe(
      normalizeHookBodyForDedupe(cursor),
    );
  });
});

describe('pluginHookMergeKey', () => {
  it('matches sibling sessionStart hooks after path rewrite', () => {
    const a = {
      on: 'sessionStart',
      type: 'command' as const,
      command:
        '"C:/plugins/superpowers/hooks/run-hook.cmd" session-start',
    };
    const b = {
      on: 'sessionStart',
      type: 'command' as const,
      command: 'C:/plugins/superpowers/hooks/run-hook.cmd session-start',
    };
    expect(pluginHookMergeKey(a)).toBe(pluginHookMergeKey(b));
  });
});

describe('matchersCompatible', () => {
  it('allows empty vs Claude SessionStart matcher', () => {
    expect(matchersCompatible('startup|clear|compact', undefined)).toBe(true);
    expect(matchersCompatible(undefined, 'startup|clear|compact')).toBe(true);
  });

  it('rejects two different non-empty matchers', () => {
    expect(matchersCompatible('Write', 'Edit')).toBe(false);
  });
});

describe('coalescePluginHook', () => {
  const sourcePlugin = {
    id: 'superpowers',
    name: 'superpowers',
    provider: 'claude' as const,
  };

  it('merges cursor into claude entry despite SessionStart matcher', () => {
    const merged: Hook[] = [
      {
        id: 'plugin-superpowers-sessionstart-0',
        on: 'sessionStart',
        type: 'command',
        command: '"C:/p/hooks/run-hook.cmd" session-start',
        matcher: 'startup|clear|compact',
        providers: ['claude-code'],
        sourcePlugin,
      },
    ];
    const absorbed = coalescePluginHook(
      merged,
      'superpowers',
      {
        id: 'plugin-superpowers-cursor-sessionstart-0',
        on: 'sessionStart',
        type: 'command',
        command: 'C:/p/hooks/run-hook.cmd session-start',
        providers: ['cursor'],
        sourcePlugin,
      },
      'cursor',
    );
    expect(absorbed).toBe(true);
    expect(merged).toHaveLength(1);
    expect(merged[0].providers).toBeUndefined();
    expect(merged[0].matcher).toBeUndefined();
  });

  it('does not merge different tool matchers with the same command', () => {
    const merged: Hook[] = [
      {
        id: 'a',
        on: 'beforeTool',
        type: 'command',
        command: 'echo',
        matcher: 'Write',
        providers: ['claude-code'],
        sourcePlugin,
      },
    ];
    expect(
      coalescePluginHook(
        merged,
        'superpowers',
        {
          id: 'b',
          on: 'beforeTool',
          type: 'command',
          command: 'echo',
          matcher: 'Edit',
          providers: ['cursor'],
          sourcePlugin,
        },
        'cursor',
      ),
    ).toBe(false);
    expect(merged).toHaveLength(1);
  });

  it('returns false when bodies differ', () => {
    const merged: Hook[] = [
      {
        id: 'plugin-superpowers-sessionstart-0',
        on: 'sessionStart',
        type: 'command',
        command: 'echo a',
        providers: ['claude-code'],
        sourcePlugin,
      },
    ];
    expect(
      coalescePluginHook(
        merged,
        'superpowers',
        {
          id: 'other',
          on: 'sessionStart',
          type: 'command',
          command: 'echo b',
          providers: ['cursor'],
          sourcePlugin,
        },
        'cursor',
      ),
    ).toBe(false);
    expect(merged).toHaveLength(1);
  });
});
