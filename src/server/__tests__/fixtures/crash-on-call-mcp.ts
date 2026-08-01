/**
 * Minimal newline-delimited JSON-RPC MCP server that exits on tools/call.
 * Used by mcp-proxy crash-failfast tests.
 *
 * Usage: bun <this-file>
 */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function reply(id: unknown, result: unknown): void {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

for await (const line of rl) {
	if (!line.trim()) continue;
	let msg: {
		id?: unknown;
		method?: string;
		params?: { name?: string };
	};
	try {
		msg = JSON.parse(line);
	} catch {
		continue;
	}

	if (msg.method === "initialize") {
		reply(msg.id, {
			protocolVersion: "2024-11-05",
			capabilities: { tools: {} },
			serverInfo: { name: "crash-on-call", version: "0.0.0" },
		});
		continue;
	}

	if (msg.method === "notifications/initialized") {
		continue;
	}

	if (msg.method === "tools/list") {
		reply(msg.id, {
			tools: [
				{
					name: "boom",
					description: "Exits the process",
					inputSchema: { type: "object", properties: {} },
				},
			],
		});
		continue;
	}

	if (msg.method === "tools/call") {
		// Crash mid-request — capa must fail fast instead of waiting for timeouts.
		process.exit(101);
	}
}
