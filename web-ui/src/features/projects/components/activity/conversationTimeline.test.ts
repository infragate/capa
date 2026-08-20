import { describe, expect, it } from 'bun:test';
import type { ActivityRun } from './groupActivityRuns';
import {
  buildConversationTimelineBlocks,
  runsOverlap,
  sortRunsChronological,
} from './conversationTimeline';

function run(
  id: string,
  started_at: number,
  duration_ms: number,
): ActivityRun {
  return {
    id,
    conversationId: 'conv-1',
    generationId: id,
    title: id,
    prompt: null,
    spans: [],
    started_at,
    source: 'cursor',
    hasError: false,
    duration_ms,
  };
}

describe('conversationTimeline', () => {
  it('sorts runs earliest-first', () => {
    const sorted = sortRunsChronological([run('b', 200, 50), run('a', 100, 50)]);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('detects overlapping runs', () => {
    expect(runsOverlap(run('a', 0, 100), run('b', 50, 100), 10_000)).toBe(true);
    expect(runsOverlap(run('a', 0, 40), run('b', 100, 40), 10_000)).toBe(false);
  });

  it('groups overlapping runs into concurrent blocks', () => {
    const blocks = buildConversationTimelineBlocks(
      [run('a', 0, 100), run('b', 50, 100), run('c', 300, 50)],
      10_000,
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('concurrent');
    if (blocks[0]?.kind === 'concurrent') {
      expect(blocks[0].runs.map((r) => r.id)).toEqual(['a', 'b']);
    }
    expect(blocks[1]?.kind).toBe('single');
    if (blocks[1]?.kind === 'single') {
      expect(blocks[1].run.id).toBe('c');
    }
  });

  it('orders blocks chronologically', () => {
    const blocks = buildConversationTimelineBlocks(
      [run('late', 500, 20), run('early', 100, 20)],
      10_000,
    );
    expect(blocks[0]?.kind).toBe('single');
    if (blocks[0]?.kind === 'single') expect(blocks[0].run.id).toBe('early');
  });
});
