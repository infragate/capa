import { describe, expect, it } from 'bun:test';
import {
  buildFilePathTree,
  treeNodeIsDirectory,
  treeNodeIsFileLeaf,
} from '../../../../components/common/FileTree';
import type { ToolCallRecord } from '../../../../types/api';
import {
  buildRunFileTree,
  collectRunFileChanges,
  collectRunSkillFolders,
  commonPathPrefix,
  buildDisplayPathKeyByEventId,
  runFilesForFileTree,
  skillFolderFromSkillMdPath,
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

  it('marks explicit directory Grep scopes as folder leaves', () => {
    const real = '/proj';
    const events = [
      call({
        id: 'grep-1',
        kind: 'agent_tool',
        tool_name: 'Grep',
        args_json: JSON.stringify({ path: `${real}/src/` }),
      }),
    ];
    const entries = collectRunFileChanges(events, { realProjectPath: real });
    const { directoryPathKeys } = runFilesForFileTree(entries, { realProjectPath: real });
    expect(directoryPathKeys).toEqual(['src']);
  });

  it('nests Grep directory scopes structurally when files were read underneath', () => {
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
    const tree = runFilesForFileTree(entries, { realProjectPath: real });
    expect(tree.directoryPathKeys).toEqual([]);
    const root = buildFilePathTree(tree.files, tree.directoryPathKeys);
    expect(treeNodeIsDirectory(root, 'src')).toBe(true);
    expect(treeNodeIsFileLeaf(root, 'src/foo.ts')).toBe(true);
  });

  it('keeps file paths as files when Grep and Read touch the same path', () => {
    const real = 'c:/Users/Tony Zaitoun/Documents/Projects/capa';
    const api = `${real}/web-ui/src/types/api.ts`;
    const events = [
      call({
        id: 'read-1',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: api }),
      }),
      call({
        id: 'grep-1',
        kind: 'agent_tool',
        tool_name: 'Grep',
        args_json: JSON.stringify({ path: api }),
      }),
    ];
    const entries = collectRunFileChanges(events, { realProjectPath: real });
    const tree = runFilesForFileTree(entries, { realProjectPath: real });
    expect(tree.directoryPathKeys).toEqual([]);
    const root = buildFilePathTree(tree.files, tree.directoryPathKeys);
    expect(treeNodeIsFileLeaf(root, 'web-ui/src/types/api.ts')).toBe(true);
  });

  it('does not treat Grep-only file paths as folder leaves', () => {
    const real = 'c:/Users/Tony Zaitoun/Documents/Projects/capa';
    const api = `${real}/web-ui/src/types/api.ts`;
    const events = [
      call({
        id: 'grep-1',
        kind: 'agent_tool',
        tool_name: 'Grep',
        args_json: JSON.stringify({ path: api }),
      }),
    ];
    const entries = collectRunFileChanges(events, { realProjectPath: real });
    const tree = runFilesForFileTree(entries, { realProjectPath: real });
    expect(tree.directoryPathKeys).toEqual([]);
    const root = buildFilePathTree(tree.files, tree.directoryPathKeys);
    expect(treeNodeIsFileLeaf(root, 'web-ui/src/types/api.ts')).toBe(true);
  });

  it('strips Windows project-root Grep paths without duplicating drive letters', () => {
    const real = 'C:/Users/Tony Zaitoun/Documents/Projects/meta';
    const events = [
      call({
        id: 'grep-1',
        kind: 'agent_tool',
        tool_name: 'Grep',
        args_json: JSON.stringify({ path: real }),
      }),
      call({
        id: 'read-1',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({
          path: `${real}/.cursor/skills/slack-cli/SKILL.md`,
        }),
      }),
      call({
        id: 'read-2',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: `${real}/capabilities.yaml` }),
      }),
    ];
    const entries = collectRunFileChanges(events, { realProjectPath: real });
    const { files, directoryPathKeys } = runFilesForFileTree(entries, {
      realProjectPath: real,
    });
    expect(files.sort()).toEqual([
      '.cursor/skills/slack-cli/SKILL.md',
      'capabilities.yaml',
    ]);
    expect(directoryPathKeys).toEqual([]);
    expect(files.some((f) => f.startsWith('C:'))).toBe(false);
  });
});

describe('commonPathPrefix', () => {
  it('returns shared directory prefix', () => {
    expect(commonPathPrefix(['/a/b/c.ts', '/a/b/d.ts'])).toBe('/a/b/');
  });
});

describe('collectRunSkillFolders', () => {
  it('derives parent folder from SKILL.md paths', () => {
    expect(skillFolderFromSkillMdPath('.cursor/skills/debug/SKILL.md')).toBe('debug');
    expect(skillFolderFromSkillMdPath('debug/SKILL.md')).toBe('debug');
    expect(skillFolderFromSkillMdPath('/proj/foo.ts')).toBeNull();
  });

  it('collects unique skill folders from file activity', () => {
    const events = [
      call({
        id: '1',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: '.cursor/skills/debug/SKILL.md' }),
      }),
      call({
        id: '2',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: '.cursor/skills/standup/SKILL.md' }),
      }),
      call({
        id: '3',
        kind: 'agent_tool',
        tool_name: 'Read',
        args_json: JSON.stringify({ path: '.cursor/skills/debug/SKILL.md' }),
      }),
    ];
    expect(collectRunSkillFolders(events)).toEqual(['debug', 'standup']);
  });
});
