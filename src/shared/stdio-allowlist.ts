import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { MCPServer, MCPServerDefinition } from "../types/capabilities";
import { getCapaDir } from "./config";

function sortedEnv(
	env: Record<string, string> | undefined,
): Record<string, string> | null {
	if (!env) return null;
	return Object.fromEntries(
		Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
	);
}

/** Stable fingerprint of a stdio MCP launch (cmd/args/cwd/env). */
export function stdioLaunchFingerprint(def: MCPServerDefinition): string {
	return JSON.stringify({
		cmd: def.cmd ?? null,
		args: def.args ?? null,
		cwd: def.cwd ?? null,
		env: sortedEnv(def.env),
	});
}

function allowlistFile(projectId: string): string {
	return join(getCapaDir(), "stdio-allowlist", `${projectId}.json`);
}

function readFingerprints(projectId: string): Set<string> {
	try {
		const parsed = JSON.parse(readFileSync(allowlistFile(projectId), "utf8")) as {
			fingerprints?: unknown;
		};
		return new Set(
			Array.isArray(parsed.fingerprints)
				? parsed.fingerprints.filter((v): v is string => typeof v === "string")
				: [],
		);
	} catch {
		return new Set();
	}
}

/**
 * HTTP MCP servers are not spawned locally. Stdio servers must be recorded by
 * a local CLI install/configure before the server process will spawn them.
 */
export function isStdioTrusted(
	projectId: string,
	def: MCPServerDefinition,
): boolean {
	if (!def.cmd) return true;
	return readFingerprints(projectId).has(stdioLaunchFingerprint(def));
}

export function trustStdioServers(
	projectId: string,
	servers: MCPServer[],
): void {
	const fingerprints = readFingerprints(projectId);
	for (const server of servers) {
		if (server.def?.cmd) {
			fingerprints.add(stdioLaunchFingerprint(server.def));
		}
	}
	const dir = join(getCapaDir(), "stdio-allowlist");
	mkdirSync(dir, { recursive: true });
	const path = allowlistFile(projectId);
	writeFileSync(path, JSON.stringify({ fingerprints: [...fingerprints] }), {
		mode: 0o600,
	});
	try {
		chmodSync(path, 0o600);
	} catch {
		// best-effort on platforms that don't support chmod
	}
}
