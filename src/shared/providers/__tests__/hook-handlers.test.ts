import { describe, it, expect } from 'bun:test';
import {
  buildHookEntry,
  buildNameTag,
  isCapaNameTag,
  upsertHookEntry,
  removeHookEntryAt,
} from '../hook-handlers';
import type { HooksIntegration } from '../../../types/providers';
import type { Hook } from '../../../types/hooks';

const claudeIntegration: HooksIntegration = {
  storage: { kind: 'inline-config', configPath: '.claude/settings.json', format: 'json', hooksKey: 'hooks' },
  shape: 'claude',
  supportsNameTag: true,
  eventMap: {
    beforeTool: { event: 'PreToolUse' },
    beforeShell: { event: 'PreToolUse', matcherPrefix: 'Bash' },
    afterFileEdit: { event: 'PostToolUse', matcherPrefix: 'Edit|MultiEdit|Write' },
  },
};

const cursorIntegration: HooksIntegration = {
  storage: { kind: 'standalone', configPath: '.cursor/hooks.json', format: 'json', envelope: 'cursor-v1' },
  shape: 'cursor',
  supportsNameTag: true,
  eventMap: {
    beforeShell: { event: 'beforeShellExecution' },
  },
};

const codexIntegration: HooksIntegration = {
  storage: { kind: 'inline-config', configPath: '.codex/config.toml', format: 'toml', hooksKey: 'hooks' },
  shape: 'codex-toml',
  supportsNameTag: false,
  eventMap: {
    beforeShell: { event: 'PreShellExec' },
  },
};

describe('hook-handlers — buildHookEntry', () => {
  it('claude shape emits a name-tagged command entry', () => {
    const hook: Hook = { id: 'lint', on: 'beforeShell', command: 'echo lint' };
    const out = buildHookEntry(claudeIntegration, {
      hook,
      runReference: '/abs/path/to/script',
      mapping: { event: 'PreToolUse', matcherPrefix: 'Bash' },
    });
    expect(out.eventName).toBe('PreToolUse');
    expect(out.matcher).toBe('Bash');
    expect(out.entry.command).toBe('/abs/path/to/script');
    expect(out.entry.type).toBe('command');
    expect(out.nameTag).toBe('capa:lint');
    expect(out.entry.name).toBe('capa:lint');
  });

  it('cursor shape stores entries as flat arrays with pattern + name', () => {
    const hook: Hook = { id: 'block-rm', on: 'beforeShell', command: 'echo blocked', matcher: 'rm -rf' };
    const out = buildHookEntry(cursorIntegration, {
      hook,
      runReference: 'echo blocked',
      mapping: { event: 'beforeShellExecution' },
    });
    expect(out.eventName).toBe('beforeShellExecution');
    expect(out.entry.pattern).toBe('rm -rf');
    expect(out.entry.name).toBe('capa:block-rm');
  });

  it('claude shape unions matcherPrefix with user matcher (preserves canonical scope)', () => {
    const hook: Hook = { id: 'edit-ts', on: 'afterFileEdit', command: 'echo', matcher: 'src/.+\\.ts' };
    const out = buildHookEntry(claudeIntegration, {
      hook,
      runReference: '/abs/script',
      mapping: { event: 'PostToolUse', matcherPrefix: 'Edit|MultiEdit|Write' },
    });
    expect(out.eventName).toBe('PostToolUse');
    expect(out.matcher).toBe('Edit|MultiEdit|Write|src/.+\\.ts');
  });

  it('claude shape skips union when user matcher equals prefix', () => {
    const hook: Hook = { id: 'shell', on: 'beforeShell', command: 'echo', matcher: 'Bash' };
    const out = buildHookEntry(claudeIntegration, {
      hook,
      runReference: '/abs/script',
      mapping: { event: 'PreToolUse', matcherPrefix: 'Bash' },
    });
    expect(out.matcher).toBe('Bash');
  });

  it('codex-toml shape emits id without name tag', () => {
    const hook: Hook = { id: 'audit-shell', on: 'beforeShell', command: 'echo' };
    const out = buildHookEntry(codexIntegration, {
      hook,
      runReference: '/abs/script',
      mapping: { event: 'PreShellExec' },
    });
    expect(out.entry.id).toBe('audit-shell');
    expect(out.entry.command).toBe('/abs/script');
    expect(out.nameTag).toBeNull();
  });
});

describe('hook-handlers — upsertHookEntry / removeHookEntryAt', () => {
  it('claude: upserts under matcher and removes precisely', () => {
    const root: Record<string, unknown> = {};
    const out = buildHookEntry(claudeIntegration, {
      hook: { id: 'h1', on: 'beforeShell', command: 'echo' },
      runReference: '/a',
      mapping: { event: 'PreToolUse', matcherPrefix: 'Bash' },
    });
    const locator = upsertHookEntry(claudeIntegration, root, out);
    expect(locator).toEqual(['PreToolUse', 0, 'hooks', 0]);
    expect(((root.PreToolUse as unknown[])[0] as { matcher: string }).matcher).toBe('Bash');

    const removed = removeHookEntryAt(claudeIntegration, root, locator, 'h1');
    expect(removed).toBe(true);
    expect(root.PreToolUse).toBeUndefined();
  });

  it('cursor: replaces existing entry with same name tag', () => {
    const root: Record<string, unknown> = {};
    const inputs: Hook = { id: 'h2', on: 'beforeShell', command: 'first' };
    const first = buildHookEntry(cursorIntegration, {
      hook: inputs,
      runReference: 'first',
      mapping: { event: 'beforeShellExecution' },
    });
    upsertHookEntry(cursorIntegration, root, first);

    const second = buildHookEntry(cursorIntegration, {
      hook: inputs,
      runReference: 'second',
      mapping: { event: 'beforeShellExecution' },
    });
    const locator = upsertHookEntry(cursorIntegration, root, second);
    expect((root.beforeShellExecution as unknown[]).length).toBe(1);
    expect(((root.beforeShellExecution as unknown[])[0] as { command: string }).command).toBe('second');
    expect(locator).toEqual(['beforeShellExecution', 0]);
  });

  it('refuses to remove an entry whose name does not match the hook id', () => {
    const root: Record<string, unknown> = {
      PreToolUse: [{ matcher: '', hooks: [{ name: 'capa:other', command: 'x', type: 'command' }] }],
    };
    const removed = removeHookEntryAt(claudeIntegration, root, ['PreToolUse', 0, 'hooks', 0], 'expected');
    expect(removed).toBe(false);
    expect((root.PreToolUse as unknown[]).length).toBe(1);
  });
});

describe('hook-handlers — name tag helpers', () => {
  it('build/recognise tag round-trips', () => {
    const tag = buildNameTag('foo');
    expect(tag).toBe('capa:foo');
    expect(isCapaNameTag(tag)).toBe(true);
    expect(isCapaNameTag(tag, 'foo')).toBe(true);
    expect(isCapaNameTag(tag, 'bar')).toBe(false);
    expect(isCapaNameTag('user-named')).toBe(false);
  });
});
