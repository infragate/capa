import { describe, it, expect } from 'bun:test';
import {
  buildHookEntry,
  buildNameTag,
  isCapaNameTag,
  upsertHookEntry,
  removeHookEntryAt,
} from '../hook-handlers';
import { providers } from '../registry';
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

  it('cursor shape stores entries as flat arrays with matcher + name', () => {
    const hook: Hook = { id: 'block-rm', on: 'beforeShell', command: 'echo blocked', matcher: 'rm -rf' };
    const out = buildHookEntry(cursorIntegration, {
      hook,
      runReference: 'echo blocked',
      mapping: { event: 'beforeShellExecution' },
    });
    expect(out.eventName).toBe('beforeShellExecution');
    expect(out.entry.command).toBe('echo blocked');
    expect(out.entry.type).toBeUndefined();
    expect(out.entry.matcher).toBe('rm -rf');
    expect(out.entry.pattern).toBeUndefined();
    expect(out.entry.name).toBe('capa:block-rm');
  });

  it('cursor shape preserves matcher verbatim on postToolUse and never emits pattern', () => {
    const hook: Hook = {
      id: 'cursor-matcher-repro',
      on: 'afterTool',
      command: './.agent/hooks/check-stale-docs-cursor.sh',
      matcher: 'Write|Edit',
      timeout: 10,
    };
    const out = buildHookEntry(cursorIntegration, {
      hook,
      runReference: './.agent/hooks/check-stale-docs-cursor.sh',
      mapping: { event: 'postToolUse' },
    });
    expect(out.eventName).toBe('postToolUse');
    expect(out.entry.matcher).toBe('Write|Edit');
    expect(out.entry.pattern).toBeUndefined();
    expect(Object.keys(out.entry).sort()).toEqual(
      ['command', 'matcher', 'name', 'timeout'].sort(),
    );
  });

  it('cursor shape emits a prompt entry for type: prompt hooks', () => {
    // Cursor's prompt-based hooks use `{ type: "prompt", prompt: <text> }`
    // (LLM-evaluated) rather than a `command`. See cursor.com/docs/agent/hooks.
    const hook: Hook = {
      id: 'safe-shell',
      on: 'beforeShell',
      type: 'prompt',
      prompt: 'Only allow read-only commands.',
      matcher: 'rm -rf',
      timeout: 10,
    };
    const out = buildHookEntry(cursorIntegration, {
      hook,
      runReference: 'Only allow read-only commands.',
      mapping: { event: 'beforeShellExecution' },
    });
    expect(out.eventName).toBe('beforeShellExecution');
    expect(out.entry.type).toBe('prompt');
    expect(out.entry.prompt).toBe('Only allow read-only commands.');
    expect(out.entry.command).toBeUndefined();
    expect(out.entry.matcher).toBe('rm -rf');
    expect(out.entry.pattern).toBeUndefined();
    expect(out.entry.timeout).toBe(10);
    expect(out.entry.name).toBe('capa:safe-shell');
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

  it('claude shape keeps a user matcher already inside the canonical family', () => {
    const build = (matcher: string, matcherPrefix: string) =>
      buildHookEntry(claudeIntegration, {
        hook: { id: 'h', on: 'afterMcpCall', command: 'echo', matcher },
        runReference: '/abs/script',
        mapping: { event: 'PostToolUse', matcherPrefix },
      }).matcher;
    // Unioning with `mcp__.*` would fire for every MCP tool.
    expect(build('mcp__github__.*', 'mcp__.*')).toBe('mcp__github__.*');
    expect(build('mcp__github__.*|mcp__jira__.*', 'mcp__.*')).toBe('mcp__github__.*|mcp__jira__.*');
    expect(build('Write', 'Edit|MultiEdit|Write')).toBe('Write');
    expect(build('Edit|Write', 'Edit|MultiEdit|Write')).toBe('Edit|Write');
    // Anchors and a wrapping group don't change the scope.
    expect(build('^mcp__github__.*$', 'mcp__.*')).toBe('^mcp__github__.*$');
    expect(build('(?:mcp__github__.*)', 'mcp__.*')).toBe('(?:mcp__github__.*)');
    expect(build('^mcp__github__.*$|^mcp__jira__.*$', 'mcp__.*')).toBe('^mcp__github__.*$|^mcp__jira__.*$');
    expect(build('^(Write)$', 'Edit|MultiEdit|Write')).toBe('^(Write)$');
    expect(build('^(?:mcp__github__.*)$', 'mcp__.*')).toBe('^(?:mcp__github__.*)$');
    expect(build('(?:^mcp__github__.*$)', 'mcp__.*')).toBe('(?:^mcp__github__.*$)');
    // Groups other than one wrapping group: can't tell, so union.
    expect(build('mcp__(github|jira)__.*', 'mcp__.*')).toBe('(?:mcp__.*)|(?:mcp__(github|jira)__.*)');
    // Anything reaching outside the family still gets the union.
    expect(build('mcp__github__.*|Bash', 'mcp__.*')).toBe('(?:mcp__.*)|(?:mcp__github__.*|Bash)');
    expect(build('Write|Bash', 'Edit|MultiEdit|Write')).toBe('(?:Edit|MultiEdit|Write)|(?:Write|Bash)');
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

  it('removes every entry when earlier removals make later locators stale', () => {
    const root: Record<string, unknown> = {};
    const install = (id: string, matcherPrefix?: string) =>
      upsertHookEntry(
        claudeIntegration,
        root,
        buildHookEntry(claudeIntegration, {
          hook: { id, on: 'afterTool', command: id },
          runReference: id,
          mapping: { event: 'PostToolUse', matcherPrefix },
        }),
      );
    // Each in its own matcher group, as capa's activity hooks are.
    const locators = [install('a'), install('b', 'Bash'), install('c', 'Edit'), install('d', 'mcp__.*')];
    expect(locators[3]).toEqual(['PostToolUse', 3, 'hooks', 0]);

    // Removing in install order shifts the later groups down.
    ['a', 'b', 'c', 'd'].forEach((id, i) => {
      expect(removeHookEntryAt(claudeIntegration, root, locators[i], id)).toBe(true);
    });
    expect(root.PostToolUse).toBeUndefined();
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

describe('hook-handlers — antigravity shape', () => {
  // .agents/hooks.json maps hook NAMES to event configs.
  // Docs: https://antigravity.google/docs/hooks/
  const integration = providers.antigravity.hooks!;
  const build = (hook: Hook) =>
    buildHookEntry(integration, {
      hook,
      runReference: hook.command ?? '',
      mapping: integration.eventMap[hook.on as keyof typeof integration.eventMap]!,
    });

  it('keys each capa hook by name tag, matcher-grouped for tool events', () => {
    const root: Record<string, unknown> = { 'user-hook': { Stop: [{ command: 'u' }] } };
    const loc = upsertHookEntry(integration, root, build({ id: 'sh', on: 'beforeShell', command: 'check', timeout: 5 }));
    upsertHookEntry(integration, root, build({ id: 'done', on: 'stop', command: 'bye', matcher: 'ignored' }));
    expect(loc).toEqual(['capa:sh']);
    expect(root).toEqual({
      'user-hook': { Stop: [{ command: 'u' }] },
      'capa:sh': {
        PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: 'check', timeout: 5 }] }],
      },
      // Non-tool events list handlers directly; matcher is dropped.
      'capa:done': { Stop: [{ type: 'command', command: 'bye' }] },
    });
  });

  it('re-install keeps a user enabled:false toggle; remove leaves user hooks', () => {
    const root: Record<string, unknown> = {};
    const loc = upsertHookEntry(integration, root, build({ id: 'x', on: 'afterTool', command: 'a' }));
    (root['capa:x'] as Record<string, unknown>).enabled = false;
    upsertHookEntry(integration, root, build({ id: 'x', on: 'afterTool', command: 'b' }));
    expect(root['capa:x']).toEqual({
      enabled: false,
      PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'b' }] }],
    });
    root.user = { Stop: [] };
    expect(removeHookEntryAt(integration, root, loc, 'x')).toBe(true);
    expect(removeHookEntryAt(integration, root, ['stale'], 'x')).toBe(false);
    expect(root).toEqual({ user: { Stop: [] } });
  });

  it('passthrough keys are namespaced so they never replace a user hook', () => {
    const root: Record<string, unknown> = { lint: { Stop: [{ command: 'mine' }] } };
    const out = buildHookEntry(integration, {
      hook: { id: 'lint', on: 'stop', command: 'theirs' },
      runReference: 'theirs',
      mapping: integration.eventMap.stop!,
      nameTagPrefix: '',
    });
    expect(upsertHookEntry(integration, root, out)).toEqual(['capa-passthrough:lint']);
    expect(root.lint).toEqual({ Stop: [{ command: 'mine' }] });
    // Not capa-managed: clean's name-tag fallback must not claim it.
    expect(removeHookEntryAt(integration, root, ['capa-passthrough:lint'], 'lint')).toBe(false);
  });

  it('rejects prompt hooks (Antigravity only runs commands)', () => {
    expect(() => build({ id: 'p', on: 'stop', type: 'prompt', prompt: 'hi' } as Hook)).toThrow();
  });

  it('rejects an event named "enabled" (it is the on/off toggle key)', () => {
    expect(() =>
      buildHookEntry(integration, {
        hook: { id: 'e', on: 'antigravity:enabled', command: 'x' },
        runReference: 'x',
        mapping: { event: 'enabled' },
      }),
    ).toThrow(/toggle/);
  });
});
