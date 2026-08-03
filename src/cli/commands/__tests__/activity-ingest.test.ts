import { describe, expect, it, spyOn, afterEach } from "bun:test";
import {
	activityIngestCommand,
	activityIngestGateStdout,
} from "../activity-ingest";

describe("activityIngestGateStdout", () => {
	it("emits permission allow for Cursor gate events", () => {
		expect(activityIngestGateStdout("beforeFileRead")).toBe(
			JSON.stringify({ permission: "allow" }),
		);
		expect(activityIngestGateStdout("subagentStart")).toBe(
			JSON.stringify({ permission: "allow" }),
		);
		expect(activityIngestGateStdout("beforeTool")).toBe(
			JSON.stringify({ permission: "allow" }),
		);
		expect(activityIngestGateStdout("beforeShell")).toBe(
			JSON.stringify({ permission: "allow" }),
		);
		expect(activityIngestGateStdout("beforeMcpCall")).toBe(
			JSON.stringify({ permission: "allow" }),
		);
	});

	it("emits continue for userPromptSubmit", () => {
		expect(activityIngestGateStdout("userPromptSubmit")).toBe(
			JSON.stringify({ continue: true }),
		);
	});

	it("emits nothing for observational events", () => {
		expect(activityIngestGateStdout("afterTool")).toBeNull();
		expect(activityIngestGateStdout("afterFileEdit")).toBeNull();
		expect(activityIngestGateStdout("sessionEnd")).toBeNull();
		expect(activityIngestGateStdout(null)).toBeNull();
	});
});

describe("activityIngestCommand gate stdout", () => {
	const writes: string[] = [];
	let writeSpy: ReturnType<typeof spyOn>;

	afterEach(() => {
		writes.length = 0;
		writeSpy?.mockRestore();
	});

	it("always writes allow JSON for beforeFileRead even when project is missing", async () => {
		writeSpy = spyOn(process.stdout, "write").mockImplementation(((
			chunk: string | Uint8Array,
		) => {
			writes.push(
				typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
			);
			return true;
		}) as typeof process.stdout.write);

		await activityIngestCommand([
			"--event",
			"beforeFileRead",
			"--provider",
			"cursor",
		]);

		const joined = writes.join("");
		expect(joined).toContain(JSON.stringify({ permission: "allow" }));
		expect(() => JSON.parse(joined.trim())).not.toThrow();
		expect(JSON.parse(joined.trim())).toEqual({ permission: "allow" });
	});

	it("writes continue JSON for userPromptSubmit", async () => {
		writeSpy = spyOn(process.stdout, "write").mockImplementation(((
			chunk: string | Uint8Array,
		) => {
			writes.push(
				typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
			);
			return true;
		}) as typeof process.stdout.write);

		await activityIngestCommand([
			"--project",
			"capa-test",
			"--event",
			"userPromptSubmit",
			"--provider",
			"cursor",
		]);

		expect(JSON.parse(writes.join("").trim())).toEqual({ continue: true });
	});

	it("stays fail-open when stdout.write throws", async () => {
		writeSpy = spyOn(process.stdout, "write").mockImplementation((() => {
			throw new Error("EPIPE");
		}) as typeof process.stdout.write);

		await expect(
			activityIngestCommand(["--event", "beforeFileRead", "--provider", "cursor"]),
		).resolves.toBeUndefined();
	});
});
