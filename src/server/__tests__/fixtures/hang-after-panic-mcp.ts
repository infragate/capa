/**
 * MCP server that prints a Rust-style panic to stderr on tools/call and then
 * hangs without exiting — reproduces owl-mcp Tokio-worker panic behavior.
 */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function reply(id: unknown, result: unknown): void {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

for await (const line of rl) {
	if (!line.trim()) continue;
	let msg: { id?: unknown; method?: string };
	try {
		msg = JSON.parse(line);
	} catch {
		continue;
	}

	if (msg.method === "initialize") {
		reply(msg.id, {
			protocolVersion: "2024-11-05",
			capabilities: { tools: {} },
			serverInfo: { name: "hang-after-panic", version: "0.0.0" },
		});
		continue;
	}

	if (msg.method === "notifications/initialized") continue;

	if (msg.method === "tools/list") {
		reply(msg.id, {
			tools: [
				{
					name: "boom",
					description: "Panics on stderr then hangs",
					inputSchema: { type: "object", properties: {} },
				},
			],
		});
		continue;
	}

	if (msg.method === "tools/call") {
		process.stderr.write(
			"thread 'tokio-rt-worker' (1) panicked at src/lib.rs:1:1:\nnot yet implemented: This shouldn't happen\n",
		);
		// Stay alive without answering — capa must kill us after seeing the panic.
		await new Promise(() => {});
	}
}
