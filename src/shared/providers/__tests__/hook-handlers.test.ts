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

// Codex shares the matcher-grouped Claude shape — the only difference is
// TOML serialisation (handled by `storage.format`). Capa appends a
// `name = "capa:<id>"` field for surgical updates; Codex's TOML
// deserialiser doesn't use deny_unknown_fields, so the field is ignored.
const codexIntegration: HooksIntegration = {
  storage: { kind: 'inline-config', configPath: '.codex/config.toml', format: 'toml', hooksKey: 'hooks' },
  shape: 'claude',
  supportsNameTag: true,
  eventMap: {
    beforeShell: { event: 'PreToolUse', matcherPrefix: 'Bash' },
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
    // Each side wrapped in a non-capturing group so the registry's existing
    // alternation (`Edit|MultiEdit|Write`) composes as a top-level
    // alternation with the user matcher — and so we don't shift any capture
    // group numbers the user might be referencing.
    expect(out.matcher).toBe('(?:Edit|MultiEdit|Write)|(?:src/.+\\.ts)');
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

  it('codex (claude shape) emits a matcher-grouped name-tagged command entry', () => {
    const hook: Hook = { id: 'audit-shell', on: 'beforeShell', command: 'echo' };
    const out = buildHookEntry(codexIntegration, {
      hook,
      runReference: '/abs/script',
      mapping: { event: 'PreToolUse', matcherPrefix: 'Bash' },
    });
    expect(out.eventName).toBe('PreToolUse');
    expect(out.matcher).toBe('Bash');
    expect(out.entry.command).toBe('/abs/script');
    expect(out.entry.type).toBe('command');
    expect(out.entry.name).toBe('capa:audit-shell');
    expect(out.nameTag).toBe('capa:audit-shell');
    // Critically, the entry must NOT carry a flat `id` field — the old
    // codex-toml shape did, and Codex's parser silently ignored it. Now
    // that we live in the matcher-grouped layout the entry is found via
    // the `name` tag like every other claude-style provider.
    expect(out.entry.id).toBeUndefined();
  });

  it('codex (claude shape) upserts under matcher and serialises to nested TOML layout', () => {
    const root: Record<string, unknown> = {};
    const hook: Hook = { id: 'audit-shell', on: 'beforeShell', command: 'echo' };
    const out = buildHookEntry(codexIntegration, {
      hook,
      runReference: '/abs/script',
      mapping: { event: 'PreToolUse', matcherPrefix: 'Bash' },
    });
    const locator = upsertHookEntry(codexIntegration, root, out);
    expect(locator).toEqual(['PreToolUse', 0, 'hooks', 0]);
    // The shape — matcher group at the outer level, hook entry nested
    // inside `hooks` — is what TOML round-trips as
    // `[[hooks.PreToolUse]] matcher = "Bash"` /
    // `[[hooks.PreToolUse.hooks]] type = "command" command = "..."`.
    expect(((root.PreToolUse as unknown[])[0] as { matcher: string }).matcher).toBe('Bash');
    const inner = ((root.PreToolUse as unknown[])[0] as { hooks: unknown[] }).hooks;
    expect(inner.length).toBe(1);
    expect((inner[0] as { name: string }).name).toBe('capa:audit-shell');
    // Re-installing the same hook id replaces in place rather than appending.
    const second = buildHookEntry(codexIntegration, {
      hook,
      runReference: '/abs/script-v2',
      mapping: { event: 'PreToolUse', matcherPrefix: 'Bash' },
    });
    upsertHookEntry(codexIntegration, root, second);
    const innerAfter = ((root.PreToolUse as unknown[])[0] as { hooks: unknown[] }).hooks;
    expect(innerAfter.length).toBe(1);
    expect((innerAfter[0] as { command: string }).command).toBe('/abs/script-v2');
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
