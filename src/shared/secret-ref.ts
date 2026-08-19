import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

export type SecretRef =
	| { fromEnv: string }
	| { fromCommand: string }
	| { fromFile: string };

export type SecretValue = string | SecretRef;

const SHELL_ARGV0 = new Set([
	"sh",
	"bash",
	"zsh",
	"dash",
	"fish",
	"cmd",
	"cmd.exe",
	"powershell",
	"powershell.exe",
	"pwsh",
	"pwsh.exe",
]);

export function isSecretRef(value: unknown): value is SecretRef {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const rec = value as Record<string, unknown>;
	const keys = Object.keys(rec);
	if (keys.length !== 1) return false;
	const key = keys[0];
	if (key !== "fromEnv" && key !== "fromCommand" && key !== "fromFile") {
		return false;
	}
	return typeof rec[key] === "string" && (rec[key] as string).length > 0;
}

function splitArgv(command: string): string[] {
	const tokens: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(command)) !== null) {
		tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
	}
	return tokens.filter((t) => t.length > 0);
}

function argv0Basename(program: string): string {
	const normalized = program.replace(/\\/g, "/");
	return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

function expandUserPath(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) {
		return homedir() + path.slice(1);
	}
	return path;
}

export interface SecretValueResolver {
	resolve(ref: SecretRef): string;
}

export class DefaultSecretValueResolver implements SecretValueResolver {
	resolve(ref: SecretRef): string {
		if ("fromEnv" in ref) {
			const value = process.env[ref.fromEnv];
			if (value === undefined || value === "") {
				throw new Error(
					`Secret ref fromEnv "${ref.fromEnv}" is not set in the environment`,
				);
			}
			return value;
		}
		if ("fromFile" in ref) {
			const path = resolve(expandUserPath(ref.fromFile));
			return readFileSync(path, "utf8").replace(/\r?\n$/, "");
		}
		const argv = splitArgv(ref.fromCommand);
		if (argv.length === 0) {
			throw new Error("Secret ref fromCommand is empty");
		}
		if (SHELL_ARGV0.has(argv0Basename(argv[0]!))) {
			throw new Error(
				`Secret ref fromCommand refuses to run a shell (${argv[0]})`,
			);
		}
		const result = spawnSync(argv[0]!, argv.slice(1), {
			encoding: "utf8",
			windowsHide: true,
			timeout: 15_000,
			env: process.env,
		});
		if (result.status !== 0) {
			throw new Error(
				`Secret ref fromCommand exited ${result.status ?? "null"}`,
			);
		}
		return (result.stdout ?? "").replace(/\r?\n$/, "");
	}
}

const defaultResolver = new DefaultSecretValueResolver();

export function resolveSecretRef(
	ref: SecretRef,
	resolver: SecretValueResolver = defaultResolver,
): string {
	return resolver.resolve(ref);
}

export function resolveSecretValue(
	value: SecretValue,
	resolver: SecretValueResolver = defaultResolver,
): string {
	if (typeof value === "string") return value;
	return resolver.resolve(value);
}

export function resolveSecretRecord(
	record: Record<string, SecretValue> | undefined,
	resolver: SecretValueResolver = defaultResolver,
): Record<string, string> | undefined {
	if (!record) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		out[key] = resolveSecretValue(value, resolver);
	}
	return out;
}

export function hasSecretRefs(value: unknown): boolean {
	if (isSecretRef(value)) return true;
	if (Array.isArray(value)) return value.some(hasSecretRefs);
	if (value !== null && typeof value === "object") {
		return Object.values(value as Record<string, unknown>).some(hasSecretRefs);
	}
	return false;
}
