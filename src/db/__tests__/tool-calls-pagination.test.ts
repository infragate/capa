import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CapaDatabase } from '../database';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resetSecretCryptoForTests } from '../../shared/secret-crypto';
import type { ToolCallInsert } from '../tool-calls';

function removeTempDirWithRetry(dir: string, attempts = 8): void {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') {
        throw error;
      }
      if (i === attempts - 1) return;
      Bun.sleepSync(50 * (i + 1));
    }
  }
}

function baseRow(
  id: string,
  startedAt: number,
  conversationId: string | null,
): ToolCallInsert {
  return {
    id,
    project_id: 'proj',
    session_id: null,
    started_at: startedAt,
    status: 'ok',
    source: 'cursor',
    kind: 'tool',
    tool_name: 'Shell',
    meta_tool: null,
    args_json: null,
    result_preview: null,
    result_bytes: null,
    result_tokens: null,
    error_message: null,
    agent_id: null,
    conversation_id: conversationId,
    generation_id: `gen-${id}`,
  };
}

describe('ToolCallsRepo conversation pagination', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let prevHome: string | undefined;
  let prevProfile: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-toolcalls-'));
    prevHome = process.env.HOME;
    prevProfile = process.env.USERPROFILE;
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    resetSecretCryptoForTests();
    db = new CapaDatabase(join(tempDir, 'test.db'));
    db.upsertProject({ id: 'proj', path: '/tmp/proj' });
  });

  afterEach(() => {
    db.close();
    resetSecretCryptoForTests();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    removeTempDirWithRetry(tempDir);
  });

  it('returns full conversations without splitting across pages', () => {
    for (let i = 0; i < 8; i++) {
      db.insertToolCall(baseRow(`a-${i}`, 1000 + i, 'conv-a'));
    }
    for (let i = 0; i < 4; i++) {
      db.insertToolCall(baseRow(`b-${i}`, 900 + i, 'conv-b'));
    }

    const page = db.listToolCalls('proj', { limit: 10 });
    const convA = page.calls.filter((c) => c.conversation_id === 'conv-a');
    const convB = page.calls.filter((c) => c.conversation_id === 'conv-b');

    expect(convA).toHaveLength(8);
    expect(convB).toHaveLength(0);
    expect(page.hasMore).toBe(true);
  });

  it('returns a single oversized conversation alone', () => {
    for (let i = 0; i < 60; i++) {
      db.insertToolCall(baseRow(`big-${i}`, 2000 + i, 'conv-big'));
    }
    db.insertToolCall(baseRow('old-1', 100, 'conv-old'));

    const page = db.listToolCalls('proj', { limit: 50 });
    expect(page.calls.every((c) => c.conversation_id === 'conv-big')).toBe(true);
    expect(page.calls).toHaveLength(60);
    expect(page.hasMore).toBe(true);
  });

  it('load more packs the next set of full conversations under the budget', () => {
    for (let i = 0; i < 5; i++) {
      db.insertToolCall(baseRow(`c1-${i}`, 3000 + i, 'conv-1'));
    }
    for (let i = 0; i < 5; i++) {
      db.insertToolCall(baseRow(`c2-${i}`, 2000 + i, 'conv-2'));
    }
    for (let i = 0; i < 5; i++) {
      db.insertToolCall(baseRow(`c3-${i}`, 1000 + i, 'conv-3'));
    }

    const page1 = db.listToolCalls('proj', { limit: 10 });
    expect(page1.calls.filter((c) => c.conversation_id === 'conv-1')).toHaveLength(5);
    expect(page1.calls.filter((c) => c.conversation_id === 'conv-2')).toHaveLength(5);
    expect(page1.calls.filter((c) => c.conversation_id === 'conv-3')).toHaveLength(0);

    const oldest = page1.calls[page1.calls.length - 1]!;
    const page2 = db.listToolCalls('proj', {
      limit: 10,
      beforeStartedAt: oldest.started_at,
      beforeId: oldest.id,
    });
    expect(page2.calls.every((c) => c.conversation_id === 'conv-3')).toBe(true);
    expect(page2.calls).toHaveLength(5);
  });

  it('returns all traces when filtering by conversationId', () => {
    for (let i = 0; i < 12; i++) {
      db.insertToolCall(baseRow(`x-${i}`, 500 + i, 'conv-x'));
    }
    db.insertToolCall(baseRow('y-1', 400, 'conv-y'));

    const page = db.listToolCalls('proj', { conversationId: 'conv-x' });
    expect(page.calls).toHaveLength(12);
    expect(page.hasMore).toBe(false);
  });

  it('paginates session traces with before/beforeId cursor', () => {
    for (let i = 0; i < 120; i++) {
      db.insertToolCall({
        ...baseRow(`sess-${i}`, 5000 - i, null),
        session_id: 'sess-a',
      });
    }

    const page1 = db.listToolCalls('proj', { sessionId: 'sess-a', limit: 50 });
    expect(page1.calls).toHaveLength(50);
    expect(page1.hasMore).toBe(true);

    const oldest = page1.calls[page1.calls.length - 1]!;
    const page2 = db.listToolCalls('proj', {
      sessionId: 'sess-a',
      limit: 50,
      beforeStartedAt: oldest.started_at,
      beforeId: oldest.id,
    });
    expect(page2.calls).toHaveLength(50);
    expect(page2.hasMore).toBe(true);
    expect(page2.calls.every((c) => c.session_id === 'sess-a')).toBe(true);
    expect(
      page2.calls.every((c) => c.started_at < oldest.started_at),
    ).toBe(true);
  });

  it('honors legacy before cursor without beforeId', () => {
    for (let i = 0; i < 5; i++) {
      db.insertToolCall(baseRow(`c1-${i}`, 3000 + i, 'conv-1'));
    }
    for (let i = 0; i < 5; i++) {
      db.insertToolCall(baseRow(`c2-${i}`, 2000 + i, 'conv-2'));
    }
    for (let i = 0; i < 5; i++) {
      db.insertToolCall(baseRow(`c3-${i}`, 1000 + i, 'conv-3'));
    }

    const page1 = db.listToolCalls('proj', { limit: 10 });
    const oldest = page1.calls[page1.calls.length - 1]!;
    const page2 = db.listToolCalls('proj', {
      limit: 10,
      beforeStartedAt: oldest.started_at,
    });
    expect(page2.calls.every((c) => c.conversation_id === 'conv-3')).toBe(true);
    expect(page2.calls).toHaveLength(5);
  });
});
