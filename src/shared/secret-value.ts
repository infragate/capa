import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { isAbsolute, resolve as resolvePath } from "path";
import { z } from "zod";
import type { CapaDatabase } from "../db/database";
import type { MCPServerDefinition } from "../types/capabilities";
import { isPlainObject } from "./plugin-manifest/types-helpers";
import {
	hasUnresolvedVariables,
	resolveVariablesInObject,
} from "./variable-resolver";

/** Literal string or on-demand external secret source. */
export type SecretValue =
	| string
	| { fromEnv: string }
	| { fromCommand: string }
	| { fromFile: string };

const fromEnvSchema = z
	.object({ fromEnv: z.string().min(1) })
	.strict();
const fromCommandSchema = z
	.object({ fromCommand: z.string().min(1) })
	.strict();
const fromFileSchema = z
	.object({ fromFile: z.string().min(1) })
	.strict();

export const secretValueSchema: z.ZodType<SecretValue> = z.union([
	z.string(),
	fromEnvSchema,
	fromCommandSchema,
	fromFileSchema,
]);

export const secretValueRecordSchema = z.record(z.string(), secretValueSchema);

export function isSecretValueObject(
	value: unknown,
): value is Exclude<SecretValue, string> {
	if (!isPlainObject(value)) return false;
	const keys = Object.keys(value);
	if (keys.length !== 1) return false;
	return (
		keys[0] === "fromEnv" ||
		keys[0] === "fromCommand" ||
		keys[0] === "fromFile"
	);
}

export class SecretValueResolveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SecretValueResolveError";
	}
}

export interface SecretValueResolveContext {
	/** Project root for relative fromFile paths. */
	projectPath: string;
	/** Command timeout in ms (default 10s). */
	commandTimeoutMs?: number;
	/** Override env lookup (tests). */
	env?: NodeJS.ProcessEnv;
	/** Override command runner (tests). */
	runCommand?: (command: string, timeoutMs: number) => Promise<string>;
	/** Override file reader (tests). */
	readFileText?: (path: string) => Promise<string>;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

/**
 * Resolve one secret value to a concrete string.
 * Strings are returned unchanged; object sources are fetched on demand.
 */
export async function resolveSecretValue(
	value: SecretValue,
	ctx: SecretValueResolveContext,
): Promise<string> {
	if (typeof value === "string") return value;

	if ("fromEnv" in value) {
		const env = ctx.env ?? process.env;
		const raw = env[value.fromEnv];
		if (raw === undefined || raw === "") {
			throw new SecretValueResolveError(
				`Environment variable "${value.fromEnv}" is not set`,
			);
		}
		return raw;
	}

	if ("fromFile" in value) {
		const path = isAbsolute(value.fromFile)
			? value.fromFile
			: resolvePath(ctx.projectPath, value.fromFile);
		try {
			const read = ctx.readFileText ?? ((p) => readFile(p, "utf8"));
			const text = await read(path);
			return text.replace(/\r?\n$/, "");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new SecretValueResolveError(
				`Failed to read secret file "${value.fromFile}": ${msg}`,
			);
		}
	}

	if ("fromCommand" in value) {
		const timeoutMs = ctx.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
		const run = ctx.runCommand ?? runSecretCommand;
		try {
			const stdout = await run(value.fromCommand, timeoutMs);
			const trimmed = stdout.replace(/\r?\n$/, "").trim();
			if (!trimmed) {
				throw new SecretValueResolveError(
					`Command produced empty output: ${value.fromCommand}`,
				);
			}
			return trimmed;
		} catch (err) {
			if (err instanceof SecretValueResolveError) throw err;
			const msg = err instanceof Error ? err.message : String(err);
			throw new SecretValueResolveError(
				`Failed to run secret command "${value.fromCommand}": ${msg}`,
			);
		}
	}

	const _exhaustive: never = value;
	throw new SecretValueResolveError(
		`Unhandled secret value: ${JSON.stringify(_exhaustive)}`,
	);
}

function runSecretCommand(command: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, {
			shell: true,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				const detail = stderr.trim() || `exit code ${code}`;
				reject(new Error(detail));
				return;
			}
			resolve(stdout);
		});
	});
}

/** Resolve every SecretValue in a record to concrete strings. */
export async function resolveSecretValueRecord(
	record: Record<string, SecretValue> | undefined,
	ctx: SecretValueResolveContext,
): Promise<Record<string, string> | undefined> {
	if (!record) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		out[key] = await resolveSecretValue(value, ctx);
	}
	return out;
}

export interface ResolveMcpServerDefContext extends SecretValueResolveContext {
	projectId: string;
	db: CapaDatabase;
}

/**
 * Resolve MCP def env/headers secret sources, then `${VarName}` placeholders.
 * Returns a def whose env/headers are plain strings suitable for transports.
 */
export async function resolveMcpServerDef(
	def: MCPServerDefinition,
	ctx: ResolveMcpServerDefContext,
): Promise<MCPServerDefinition> {
	const env = await resolveSecretValueRecord(def.env, ctx);
	const headers = await resolveSecretValueRecord(def.headers, ctx);
	const withSecrets: MCPServerDefinition = {
		...def,
		...(env !== undefined ? { env } : {}),
		...(headers !== undefined ? { headers } : {}),
	};
	return resolveVariablesInObject(withSecrets, ctx.projectId, ctx.db);
}

/** True if env/headers still contain unresolved secret-source objects. */
export function hasUnresolvedSecretSources(input: unknown): boolean {
	if (isSecretValueObject(input)) return true;
	if (Array.isArray(input)) {
		return input.some(hasUnresolvedSecretSources);
	}
	if (isPlainObject(input)) {
		return Object.values(input).some(hasUnresolvedSecretSources);
	}
	return false;
}

/** True if MCP def still has unresolved ${} vars or secret-source objects. */
export function hasUnresolvedMcpSecrets(def: MCPServerDefinition): boolean {
	return (
		hasUnresolvedSecretSources(def.env) ||
		hasUnresolvedSecretSources(def.headers) ||
		hasUnresolvedVariables(def)
	);
}

/** Normalize fingerprint maps that may still contain SecretValue objects. */
export function secretValueMapForFingerprint(
	record: Record<string, SecretValue> | undefined,
): Record<string, string> | undefined {
	if (!record) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		out[key] =
			typeof value === "string" ? value : JSON.stringify(value);
	}
	return out;
}
