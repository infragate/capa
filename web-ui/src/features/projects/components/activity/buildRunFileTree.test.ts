import { describe, expect, it } from 'bun:test';
import type { ToolCallRecord } from '../../../../types/api';
import {
  buildRunFileTree,
  collectRunFileChanges,
  commonPathPrefix,
  buildDisplayPathKeyByEventId,
  runFilesForFileTree,
  spanIdsForDisplayPathKey,
  spanIdsForDisplayPathKeyFromEvents,
} from './buildRunFileTree';

function call(
  partial: Partial<ToolCallRecord> & Pick<ToolCallRecord, 'id' | 'kind' | 'tool_name'>,
): ToolCallRecord {
  return {
    project_id: 'p',
    session_id: null,
    started_at: 1,
    duration_ms: 1,
    status: 'ok',
    source: 'cursor',
    meta_tool: null,
    args_json: null,
    result_preview: null,
    result_bytes: null,
    result_tokens: null,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    error_message: null,
    agent_id: null,
    conversation_id: null,
    generation_id: null,
    model: null,
    attributes_json: null,
    ...partial,
  };
}

describe('collectRunFileChanges', () => {
  it('merges read and write on the same path', () => {
    const events = [
      call({
        id: '1',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ file_path: '/proj/src/a.ts' }),
      }),
      call({
        id: '2',
        kind: 'agent_tool',
        tool_name: 'StrReplace',
        args_json: JSON.stringify({ path: '/proj/src/a.ts' }),
      }),
    ];
    const entries = collectRunFileChanges(events);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: '/proj/src/a.ts',
      read: true,
      modified: true,
      deleted: false,
    });
  });

  it('tracks file edits and deletes', () => {
    const events = [
      call({
        id: '1',
        kind: 'file',
        tool_name: '/proj/README.md',
        args_json: JSON.stringify({ path: '/proj/README.md' }),
      }),
      call({
        id: '2',
        kind: 'agent_tool',
        tool_name: 'Delete',
        args_json: JSON.stringify({ path: '/proj/old.ts' }),
      }),
    ];
    const entries = collectRunFileChanges(events);
    expect(entries.map((e) => e.path).sort()).toEqual(['/proj/README.md', '/proj/old.ts']);
    const readme = entries.find((e) => e.path.endsWith('README.md'));
    const old = entries.find((e) => e.path.endsWith('old.ts'));
    expect(readme?.modified).toBe(true);
    expect(old?.deleted).toBe(true);
  });

  it('ignores prompts and shell', () => {
    const events = [
      call({ id: '1', kind: 'prompt', tool_name: 'hi' }),
      call({ id: '2', kind: 'shell', tool_name: 'ls -la' }),
    ];
    expect(collectRunFileChanges(events)).toHaveLength(0);
  });

  it('remaps wrap shadow paths to the real project path', () => {
    const real = '/Users/me/Documents/Projects/odin';
    const shadow =
      '/Users/me/.capa/workspaces/odin-5415-cursor/odin/src/foo.ts';
    const events = [
      call({
        id: '1',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: shadow }),
      }),
    ];
    const entries = collectRunFileChanges(events, { realProjectPath: real });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(`${real}/src/foo.ts`);
    const { files } = runFilesForFileTree(entries, { realProjectPath: real });
    expect(files).toEqual(['src/foo.ts']);
  });
});

describe('buildRunFileTree', () => {
  it('nests paths under a common prefix', () => {
    const entries = collectRunFileChanges([
      call({
        id: '1',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ file_path: '/proj/src/foo.ts' }),
      }),
      call({
        id: '2',
        kind: 'agent_tool',
        tool_name: 'Write',
        args_json: JSON.stringify({ path: '/proj/src/bar.ts' }),
      }),
    ]);
    const { roots, displayPrefix } = buildRunFileTree(entries);
    expect(displayPrefix).toBe('/proj/src/');
    expect(roots.map((r) => r.name).sort()).toEqual(['bar.ts', 'foo.ts']);
    expect(roots.every((r) => r.filePath)).toBe(true);
  });
});

describe('runFilesForFileTree', () => {
  it('returns display paths and annotations for FileTree', () => {
    const entries = collectRunFileChanges([
      call({
        id: '1',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ file_path: '/proj/src/foo.ts' }),
      }),
      call({
        id: '2',
        kind: 'agent_tool',
        tool_name: 'Write',
        args_json: JSON.stringify({ path: '/proj/src/bar.ts' }),
      }),
    ]);
    const { files, annotations } = runFilesForFileTree(entries);
    expect(files.sort()).toEqual(['bar.ts', 'foo.ts']);
    expect(annotations['foo.ts']).toEqual({
      read: true,
      modified: false,
      deleted: false,
    });
  });
});

describe('spanIdsForDisplayPathKey', () => {
  it('returns spans that touch the same display path', () => {
    const real = '/Users/me/Documents/Projects/odin';
    const events = [
      call({
        id: 'read-1',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: `${real}/src/foo.ts` }),
      }),
      call({
        id: 'write-1',
        kind: 'agent_tool',
        tool_name: 'Write',
        args_json: JSON.stringify({ path: `${real}/src/foo.ts` }),
      }),
      call({
        id: 'other',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: `${real}/src/bar.ts` }),
      }),
    ];
    const entries = collectRunFileChanges(events, { realProjectPath: real });
    const index = buildDisplayPathKeyByEventId(events, entries, {
      realProjectPath: real,
    });
    const ids = spanIdsForDisplayPathKey('src/foo.ts', index);
    expect(ids.sort()).toEqual(['read-1', 'write-1']);
    expect(spanIdsForDisplayPathKeyFromEvents('src/foo.ts', events, entries, {
      realProjectPath: real,
    }).sort()).toEqual(['read-1', 'write-1']);
  });

  it('marks Grep search roots as directories in the file tree payload', () => {
    const real = '/proj';
    const events = [
      call({
        id: 'grep-1',
        kind: 'agent_tool',
        tool_name: 'Grep',
        args_json: JSON.stringify({ path: `${real}/src` }),
      }),
      call({
        id: 'read-1',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: `${real}/src/foo.ts` }),
      }),
    ];
    const entries = collectRunFileChanges(events, { realProjectPath: real });
    const { directoryPathKeys } = runFilesForFileTree(entries, { realProjectPath: real });
    expect(directoryPathKeys).toContain('src');
  });
});

describe('commonPathPrefix', () => {
  it('returns shared directory prefix', () => {
    expect(commonPathPrefix(['/a/b/c.ts', '/a/b/d.ts'])).toBe('/a/b/');
  });
});
