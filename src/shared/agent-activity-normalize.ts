/**
 * Normalize provider hook stdin JSON into a capa activity ingest payload.
 * Fail-soft: unknown shapes still produce a best-effort event.
 */

import type { ToolCallKind, ToolCallStatus } from "../types/database";
import type { CanonicalHookEvent } from "../types/hooks";
import {
	asRecord,
	extractPath,
	nested,
	nestedString,
	promptTextFrom,
	shellCommandFrom,
	stringField,
	tokenUsageFrom,
	toolNameFrom,
	type TokenUsage,
} from "./agent-activity-fields";

export interface NormalizedActivityEvent {
	kind: ToolCallKind;
	toolName: string;
	status: ToolCallStatus;
	source: string | null;
	args?: unknown;
	resultPreview?: unknown;
	errorMessage?: string | null;
	/** Provider-reported model usage (typically on `stop`). */
	tokenUsage?: TokenUsage | null;
	/** When true, caller should drop the event (capa MCP dedup). */
	skip: boolean;
	skipReason?: string;
}

/**
 * Match capa's own MCP endpoint / server — not arbitrary `/mcp` URLs.
 * Port 5912 is the default capa server port; also match capa-named paths.
 */
const CAPA_MCP_RE =
	/localhost:5912|127\.0\.0\.1:5912|capa-.*\/mcp|mcpServers\.capa\b/i;

export function normalizeActivityHookPayload(
	event: CanonicalHookEvent,
	raw: unknown,
	providerHint?: string | null,
): NormalizedActivityEvent {
	const obj = asRecord(raw) ?? {};
	const provider =
		providerHint ||
		stringField(obj, "provider") ||
		stringField(obj, "provider_id") ||
		inferProvider(obj) ||
		null;

	if (isCapaMcpPayload(obj, event)) {
		return {
			kind: "agent_mcp",
			toolName: "capa-mcp",
			status: "ok",
			source: provider,
			skip: true,
			skipReason: "capa MCP (already traced via MCP handler)",
		};
	}

	// Outcome-only: ignore lifecycle "before" noise.
	// Kept even though SYSTEM_ACTIVITY_EVENTS omits these — CLI may still receive them.
	if (
		event === "beforeTool" ||
		event === "beforeShell" ||
		event === "beforeMcpCall" ||
		event === "beforeFileRead"
	) {
		return {
			kind: "agent_tool",
			toolName: event,
			status: "ok",
			source: provider,
			skip: true,
			skipReason: "before-hook (outcome-only activity)",
		};
	}

	const kind = kindForEvent(event, obj);
	const toolName = nameForEvent(event, kind, obj);
	const status = statusForEvent(event, obj);
	const args = argsForEvent(event, obj);
	const resultPreview = resultForEvent(event, obj);
	const errorMessage = errorForEvent(event, obj);
	const tokenUsage = tokenUsageFrom(obj);

	// Shell tool wrappers duplicate afterShell / capa MCP rows.
	if (kind === "agent_tool" && isShellToolName(toolName)) {
		return {
			kind,
			toolName,
			status,
			source: provider,
			skip: true,
			skipReason: "shell tool wrapper (covered by afterShell / capa tool)",
		};
	}

	// `capa sh …` is already traced as a capa tool call via the MCP handler.
	if (kind === "shell" && isCapaShCommand(toolName)) {
		return {
			kind,
			toolName,
			status,
			source: provider,
			skip: true,
			skipReason: "capa sh (already traced via MCP handler)",
		};
	}

	return {
		kind,
		toolName,
		status,
		source: provider,
		args,
		resultPreview,
		errorMessage,
		tokenUsage,
		skip: false,
	};
}

function kindForEvent(
	event: CanonicalHookEvent,
	obj: Record<string, unknown>,
): ToolCallKind {
	if (event === "userPromptSubmit") return "prompt";
	if (event === "beforeShell" || event === "afterShell") return "shell";
	if (event === "afterFileEdit") {
		return isSkillMdPath(extractPath(obj)) ? "skill" : "file";
	}
	if (event === "beforeMcpCall" || event === "afterMcpCall") return "agent_mcp";
	if (event === "beforeTool" || event === "afterTool" || event === "afterToolFailure") {
		if (isSkillMdPath(extractPath(obj))) return "skill";
		return "agent_tool";
	}
	if (event === "sessionStart" || event === "sessionEnd") return "session";
	if (event === "subagentStart" || event === "subagentStop") return "subagent";
	if (event === "preCompact") return "compact";
	if (event === "stop") return "stop";
	return "agent_tool";
}

function nameForEvent(
	event: CanonicalHookEvent,
	kind: ToolCallKind,
	obj: Record<string, unknown>,
): string {
	if (kind === "skill") {
		return skillNameFromPath(extractPath(obj)) || "skill";
	}
	if (kind === "shell") {
		return shellCommandFrom(obj) || "shell";
	}
	if (kind === "prompt") {
		const prompt = promptTextFrom(obj);
		if (prompt) {
			const trimmed = prompt.trim().replace(/\s+/g, " ");
			return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
		}
		return "prompt";
	}
	if (kind === "file") {
		return extractPath(obj) || "file";
	}
	if (kind === "agent_mcp") {
		return toolNameFrom(obj) || "mcp";
	}
	if (kind === "session") return event;
	if (kind === "subagent") {
		return (
			stringField(obj, "subagent_type") ||
			stringField(obj, "agent_id") ||
			stringField(obj, "name") ||
			event
		);
	}
	if (kind === "compact" || kind === "stop") return event;

	return (
		toolNameFrom(obj) ||
		stringField(obj, "tool") ||
		event
	);
}

function statusForEvent(
	event: CanonicalHookEvent,
	obj: Record<string, unknown>,
): ToolCallStatus {
	if (event.startsWith("before") || event === "sessionStart" || event === "subagentStart") {
		return "ok";
	}
	if (event === "afterToolFailure") return "error";

	const explicit = stringField(obj, "status")?.toLowerCase();
	if (explicit === "error" || explicit === "failed" || explicit === "failure") {
		return "error";
	}
	if (obj.error != null || obj.error_message != null || obj.errorMessage != null) {
		return "error";
	}
	const exitCode = obj.exit_code ?? obj.exitCode ?? nested(obj, ["output", "exit_code"]);
	if (typeof exitCode === "number" && exitCode !== 0) return "error";

	return "ok";
}

function argsForEvent(
	event: CanonicalHookEvent,
	obj: Record<string, unknown>,
): unknown {
	if (event === "userPromptSubmit") {
		return { prompt: promptTextFrom(obj) };
	}
	if (event === "beforeShell" || event === "afterShell") {
		return {
			command: shellCommandFrom(obj),
			cwd: stringField(obj, "cwd") || stringField(obj, "working_directory") || null,
		};
	}
	if (event === "stop" || event === "sessionEnd") {
		const usage = tokenUsageFrom(obj);
		const out: Record<string, unknown> = {};
		const status = stringField(obj, "status");
		const model = stringField(obj, "model");
		if (status) out.status = status;
		if (model) out.model = model;
		if (usage) out.usage = usage;
		if (Object.keys(out).length > 0) return out;
	}
	const toolInput =
		obj.tool_input ?? obj.toolInput ?? obj.input ?? obj.arguments ?? obj.args;
	if (toolInput != null) return toolInput;
	const path = extractPath(obj);
	if (path) return { path };
	return summarizeRaw(obj);
}

function resultForEvent(
	event: CanonicalHookEvent,
	obj: Record<string, unknown>,
): unknown {
	if (event.startsWith("before")) return undefined;
	return (
		obj.tool_output ??
		obj.toolOutput ??
		obj.output ??
		obj.result ??
		obj.response ??
		undefined
	);
}

function errorForEvent(
	event: CanonicalHookEvent,
	obj: Record<string, unknown>,
): string | null {
	if (event !== "afterToolFailure" && statusForEvent(event, obj) !== "error") {
		return null;
	}
	return (
		stringField(obj, "error_message") ||
		stringField(obj, "errorMessage") ||
		(typeof obj.error === "string" ? obj.error : null) ||
		stringField(obj, "message") ||
		"error"
	);
}

function isCapaMcpPayload(
	obj: Record<string, unknown>,
	event: CanonicalHookEvent,
): boolean {
	if (event !== "beforeMcpCall" && event !== "afterMcpCall") {
		// Also catch generic tool events that are capa MCP wrappers
		const name = toolNameFrom(obj) || "";
		if (!/^mcp__/i.test(name) && !/capa/i.test(name)) return false;
	}

	const candidates = [
		stringField(obj, "server"),
		stringField(obj, "mcp_server"),
		stringField(obj, "mcpServer"),
		stringField(obj, "url"),
		stringField(obj, "endpoint"),
		toolNameFrom(obj),
		nestedString(obj, ["server", "url"]),
		nestedString(obj, ["server", "name"]),
		nestedString(obj, ["mcp_server", "url"]),
		nestedString(obj, ["mcpServer", "url"]),
		nestedString(obj, ["tool_input", "server"]),
		nestedString(obj, ["input", "server"]),
	];
	for (const value of candidates) {
		if (!value) continue;
		if (/^capa\b/i.test(value) || CAPA_MCP_RE.test(value)) return true;
		if (/^mcp__capa/i.test(value)) return true;
	}

	// Config-shaped payloads sometimes nest capa under mcpServers without a URL.
	const mcpServers = obj.mcpServers ?? obj.mcp_servers;
	if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
		for (const key of Object.keys(mcpServers as Record<string, unknown>)) {
			if (/^capa\b/i.test(key) || CAPA_MCP_RE.test(key)) return true;
		}
	}

	return false;
}

/** Cursor/Claude/Gemini shell tool wrappers — covered by afterShell. */
function isShellToolName(name: string): boolean {
	const n = name.trim().toLowerCase();
	return (
		n === "shell" ||
		n === "bash" ||
		n === "zsh" ||
		n === "run_terminal_cmd" ||
		n === "run_shell_command" ||
		n === "terminal" ||
		n === "powershell"
	);
}

/** Shell invocations of capa tools — MCP tracer already records the tool. */
function isCapaShCommand(command: string): boolean {
	const c = command.trim().toLowerCase();
	// Match `capa sh …` / `capa.exe sh …` even with a quoted absolute path.
	return /(?:^|[\s"'\\/])capa(\.exe)?["']?\s+sh\b/.test(c);
}

function isSkillMdPath(path: string | null): boolean {
	if (!path) return false;
	return /(^|[/\\])SKILL\.md$/i.test(path);
}

function skillNameFromPath(path: string | null): string | null {
	if (!path) return null;
	const parts = path.replace(/\\/g, "/").split("/");
	const skillIdx = parts.findIndex((p) => p.toLowerCase() === "skill.md");
	if (skillIdx > 0) return parts[skillIdx - 1] || null;
	return null;
}

function inferProvider(obj: Record<string, unknown>): string | null {
	const hookEvent =
		stringField(obj, "hook_event_name") || stringField(obj, "hookEventName");
	if (hookEvent) {
		if (/^[A-Z]/.test(hookEvent)) return "claude-code";
		if (/^(before|after|session|pre|stop)/.test(hookEvent)) return "cursor";
	}
	return null;
}

function summarizeRaw(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (k === "transcript" || k === "conversation") continue;
		if (typeof v === "string" && v.length > 500) {
			out[k] = `${v.slice(0, 500)}…`;
		} else {
			out[k] = v;
		}
		if (Object.keys(out).length >= 12) break;
	}
	return out;
}
