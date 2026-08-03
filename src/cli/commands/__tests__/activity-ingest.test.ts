import { describe, expect, it, spyOn, afterEach } from "bun:test";
import {
	activityIngestCommand,
	activityIngestGateStdout,
	clientConnectOrigin,
	parseHookStdinJson,
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

describe("parseHookStdinJson", () => {
	it("parses Cursor Agent Windows stdin that starts with UTF-8 BOM", () => {
		const payload = {
			conversation_id: "32ef633c-d2fa-458b-b8e6-b9981226ad15",
			generation_id: "8ceb8fb5-5f5b-4a6e-afb4-0b7c65e46082",
			prompt: "hi",
			hook_event_name: "beforeSubmitPrompt",
		};
		const withBom = `\uFEFF${JSON.stringify(payload)}\r\n`;
		expect(parseHookStdinJson(withBom)).toEqual(payload);
	});

	it("falls back to raw wrapper when JSON is invalid", () => {
		expect(parseHookStdinJson("not-json")).toEqual({ raw: "not-json" });
	});
});

describe("clientConnectOrigin", () => {
	it("maps wildcard bind hosts to loopback", () => {
		expect(clientConnectOrigin("0.0.0.0", 5912)).toBe("http://127.0.0.1:5912");
		expect(clientConnectOrigin("::", 5912)).toBe("http://127.0.0.1:5912");
		expect(clientConnectOrigin("[::]", 5912)).toBe("http://127.0.0.1:5912");
	});

	it("brackets bare IPv6 literals", () => {
		expect(clientConnectOrigin("::1", 5912)).toBe("http://[::1]:5912");
	});

	it("keeps localhost and IPv4 as-is", () => {
		expect(clientConnectOrigin("localhost", 5912)).toBe("http://localhost:5912");
		expect(clientConnectOrigin("127.0.0.1", 5912)).toBe("http://127.0.0.1:5912");
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
