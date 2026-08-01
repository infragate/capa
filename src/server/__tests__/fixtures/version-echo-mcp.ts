/**
 * Minimal MCP server that reports process.argv package token on tools/call.
 * Used to verify capa respawns when server args (e.g. owl-mcp@version) change.
 *
 * Usage: bun <this-file> --version-token <token>
 */
import { createInterface } from "node:readline";

const versionIdx = process.argv.indexOf("--version-token");
const versionToken =
	versionIdx >= 0 ? (process.argv[versionIdx + 1] ?? "unknown") : "unknown";

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
			serverInfo: { name: "version-echo", version: versionToken },
		});
		continue;
	}

	if (msg.method === "notifications/initialized") continue;

	if (msg.method === "tools/list") {
		reply(msg.id, {
			tools: [
				{
					name: "echo_version",
					description: "Returns the launch version token",
					inputSchema: { type: "object", properties: {} },
				},
			],
		});
		continue;
	}

	if (msg.method === "tools/call") {
		reply(msg.id, {
			content: [{ type: "text", text: versionToken }],
			isError: false,
		});
	}
}
