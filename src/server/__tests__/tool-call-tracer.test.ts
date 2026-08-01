import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CapaDatabase } from "../../db/database";
import { ToolCallsRepo } from "../../db/tool-calls";
import { initSchema } from "../../db/schema";
import {
	redactText,
	resolveToolCallSource,
	serializeForPreview,
	ToolCallTracer,
	truncateText,
} from "../tool-call-tracer";
import { notifyToolCall } from "../project-routes";
import type { ToolCallRecord } from "../../types/database";

describe("tool-call-tracer helpers", () => {
	it("maps capa-shell to shell source", () => {
		expect(resolveToolCallSource("capa-shell")).toBe("shell");
		expect(resolveToolCallSource("cursor-ide")).toBe("cursor-ide");
		expect(resolveToolCallSource(null)).toBe("mcp");
		expect(resolveToolCallSource(undefined)).toBe("mcp");
	});

	it("truncates long text", () => {
		const long = "a".repeat(100);
		const out = truncateText(long, 20);
		expect(out.startsWith("a".repeat(20))).toBe(true);
		expect(out).toContain("truncated");
	});

	it("redacts secret values", () => {
		const text = "token=super-secret-value-here and more";
		expect(redactText(text, ["super-secret-value-here"])).toBe(
			"token=[REDACTED] and more",
		);
	});

	it("serializeForPreview redacts and truncates", () => {
		const preview = serializeForPreview(
			{ apiKey: "abcdefghijklmnop", note: "ok" },
			["abcdefghijklmnop"],
			40,
		);
		expect(preview).toContain("[REDACTED]");
		expect(preview!.length).toBeLessThanOrEqual(80);
	});
});

describe("ToolCallsRepo prune", () => {
	let dir: string;
	let sqlite: Database;
	let repo: ToolCallsRepo;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "capa-tool-calls-"));
		sqlite = new Database(join(dir, "test.db"), { create: true });
		initSchema(sqlite);
		sqlite.run(
			"INSERT INTO projects (id, path, created_at, updated_at) VALUES (?, ?, ?, ?)",
			["proj-1", "/tmp/proj-1", Date.now(), Date.now()],
		);
		repo = new ToolCallsRepo(sqlite);
	});

	afterEach(() => {
		sqlite.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("deletes oldest rows beyond the cap", () => {
		for (let i = 0; i < 8; i++) {
			repo.insert({
				id: `call-${i}`,
				project_id: "proj-1",
				session_id: null,
				started_at: 1000 + i,
				duration_ms: null,
				status: "ok",
				source: "mcp",
				kind: "tool",
				tool_name: `tool-${i}`,
				meta_tool: null,
				args_json: null,
				result_preview: null,
				result_bytes: null,
				result_tokens: null,
				error_message: null,
				agent_id: null,
			});
			repo.prune("proj-1", 5);
		}

		const rows = repo.listRecent("proj-1", { limit: 20 });
		expect(rows.calls.length).toBe(5);
		expect(rows.calls.map((r) => r.id).sort()).toEqual([
			"call-3",
			"call-4",
			"call-5",
			"call-6",
			"call-7",
		]);
		expect(rows.total).toBe(5);
		expect(rows.hasMore).toBe(false);
	});

	it("pages older rows with composite before cursor", () => {
		for (let i = 0; i < 6; i++) {
			repo.insert({
				id: `page-${i}`,
				project_id: "proj-1",
				session_id: null,
				started_at: 2000 + i,
				duration_ms: null,
				status: "ok",
				source: "mcp",
				kind: "tool",
				tool_name: `tool-${i}`,
				meta_tool: null,
				args_json: null,
				result_preview: null,
				result_bytes: null,
				result_tokens: null,
				error_message: null,
				agent_id: null,
			});
		}
		const first = repo.listRecent("proj-1", { limit: 2 });
		expect(first.calls.map((c) => c.id)).toEqual(["page-5", "page-4"]);
		expect(first.hasMore).toBe(true);
		const oldest = first.calls[1]!;
		const next = repo.listRecent("proj-1", {
			limit: 2,
			beforeStartedAt: oldest.started_at,
			beforeId: oldest.id,
		});
		expect(next.calls.map((c) => c.id)).toEqual(["page-3", "page-2"]);
	});

	it("does not skip same-ms ties at a page boundary", () => {
		const ts = 5000;
		for (const id of ["a", "b", "c", "d"]) {
			repo.insert({
				id,
				project_id: "proj-1",
				session_id: null,
				started_at: ts,
				duration_ms: null,
				status: "ok",
				source: "mcp",
				kind: "tool",
				tool_name: id,
				meta_tool: null,
				args_json: null,
				result_preview: null,
				result_bytes: null,
				result_tokens: null,
				error_message: null,
				agent_id: null,
			});
		}
		const first = repo.listRecent("proj-1", { limit: 2 });
		expect(first.calls.map((c) => c.id)).toEqual(["d", "c"]);
		const oldest = first.calls[1]!;
		const next = repo.listRecent("proj-1", {
			limit: 2,
			beforeStartedAt: oldest.started_at,
			beforeId: oldest.id,
		});
		expect(next.calls.map((c) => c.id)).toEqual(["b", "a"]);
	});

	it("does not prune running traces while under pressure", () => {
		for (let i = 0; i < 4; i++) {
			repo.insert({
				id: `done-${i}`,
				project_id: "proj-1",
				session_id: null,
				started_at: 1000 + i,
				duration_ms: 1,
				status: "ok",
				source: "mcp",
				kind: "tool",
				tool_name: `done-${i}`,
				meta_tool: null,
				args_json: null,
				result_preview: null,
				result_bytes: null,
				result_tokens: null,
				error_message: null,
				agent_id: null,
			});
		}
		repo.insert({
			id: "running-old",
			project_id: "proj-1",
			session_id: null,
			started_at: 500,
			duration_ms: null,
			status: "running",
			source: "mcp",
			kind: "tool",
			tool_name: "slow",
			meta_tool: null,
			args_json: null,
			result_preview: null,
			result_bytes: null,
			result_tokens: null,
			error_message: null,
			agent_id: null,
		});

		repo.prune("proj-1", 3);
		expect(repo.get("running-old")).not.toBeNull();
		const remaining = repo.listRecent("proj-1", { limit: 20 });
		expect(remaining.calls.some((c) => c.id === "running-old")).toBe(true);
		expect(remaining.total).toBeLessThanOrEqual(4);
	});
});

describe("ToolCallTracer", () => {
	let dir: string;
	let db: CapaDatabase;
	const notified: Array<{ projectId: string; record: ToolCallRecord }> = [];

	beforeEach(() => {
		notified.length = 0;
		dir = mkdtempSync(join(tmpdir(), "capa-tracer-"));
		db = new CapaDatabase(join(dir, "test.db"));
		db.upsertProject({ id: "proj-1", path: "/tmp/proj-1" });
		db.setVariable("proj-1", "SECRET_TOKEN", "my-secret-token-value");
	});

	afterEach(() => {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("emits start and finish notifications with redacted args", () => {
		const tracer = new ToolCallTracer(db, (projectId, record) => {
			notified.push({ projectId, record });
		});

		const id = tracer.start({
			projectId: "proj-1",
			sessionId: "sess-1",
			source: "shell",
			kind: "call_tool",
			toolName: "echo",
			metaTool: "call_tool",
			args: { token: "my-secret-token-value", msg: "hi" },
		});

		expect(notified).toHaveLength(1);
		expect(notified[0].record.status).toBe("running");
		expect(notified[0].record.args_json).toContain("[REDACTED]");
		expect(notified[0].record.args_json).not.toContain("my-secret-token-value");

		const finished = tracer.finish(id, {
			status: "ok",
			resultPreview: { ok: true, token: "my-secret-token-value" },
		});

		expect(finished?.status).toBe("ok");
		expect(finished?.duration_ms).not.toBeNull();
		expect(finished?.result_preview).toContain("[REDACTED]");
		expect(notified).toHaveLength(2);
		expect(notified[1].record.status).toBe("ok");
	});

	it("measures result size before truncating the stored preview", () => {
		const tracer = new ToolCallTracer(db);
		const id = tracer.start({
			projectId: "proj-1",
			kind: "tool",
			toolName: "big",
			source: "mcp",
		});
		const original = "x".repeat(20_000);
		const finished = tracer.finish(id, {
			status: "ok",
			resultPreview: original,
		});

		expect(finished?.result_bytes).toBe(20_000);
		expect(finished?.result_tokens).toBe(Math.ceil(20_000 / 4));
		expect(finished?.result_preview?.length ?? 0).toBeLessThan(original.length);
		expect(finished?.result_preview).toContain("truncated");
	});

	it("computes activity stats", () => {
		const tracer = new ToolCallTracer(db);
		const a = tracer.start({
			projectId: "proj-1",
			kind: "tool",
			toolName: "a",
			source: "shell",
		});
		tracer.finish(a, { status: "ok", resultPreview: "x" });
		const b = tracer.start({
			projectId: "proj-1",
			kind: "tool",
			toolName: "b",
			source: "mcp",
		});
		tracer.finish(b, { status: "error", errorMessage: "boom" });

		const stats = db.getToolCallStats("proj-1");
		expect(stats.total).toBe(2);
		expect(stats.errors).toBe(1);
		expect(stats.shell).toBe(1);
		expect(stats.mcp).toBe(1);
		expect(stats.buckets).toHaveLength(60);
		expect(stats.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(2);
	});
});

describe("notifyToolCall SSE framing", () => {
	it("encodes a tool-call event for connected clients", () => {
		const chunks: Uint8Array[] = [];
		const clients = new Map<string, Set<(chunk: Uint8Array) => void>>();
		clients.set("proj-1", new Set([(chunk) => chunks.push(chunk)]));

		const record: ToolCallRecord = {
			id: "abc",
			project_id: "proj-1",
			session_id: null,
			started_at: 1,
			duration_ms: 10,
			status: "ok",
			source: "shell",
			kind: "tool",
			tool_name: "echo",
			meta_tool: null,
			args_json: "{}",
			result_preview: "hi",
			result_bytes: 2,
			result_tokens: 1,
			error_message: null,
			agent_id: null,
		};

		notifyToolCall(clients, "proj-1", record);
		expect(chunks).toHaveLength(1);
		const text = new TextDecoder().decode(chunks[0]);
		expect(text.startsWith("event: tool-call\n")).toBe(true);
		expect(text).toContain('"tool_name":"echo"');
	});
});
