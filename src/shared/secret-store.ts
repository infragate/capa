import { randomBytes } from "crypto";
import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getCapaDir } from "./config";

export type SecretStoreTier = "macos-keychain" | "windows-dpapi" | "file";

const KEY_BYTES = 32;
const KEYCHAIN_SERVICE = "capa.master-key";
const KEYCHAIN_ACCOUNT = "capa";

let cachedKey: Buffer | null = null;
let cachedTier: SecretStoreTier | null = null;
let forcedTier: SecretStoreTier | null = null;

export function resetSecretStoreForTests(): void {
	cachedKey = null;
	cachedTier = null;
	forcedTier = "file";
}

export function getSecretStoreTier(): SecretStoreTier {
	if (forcedTier) return forcedTier;
	if (cachedTier) return cachedTier;
	if (process.env.CAPA_SECRET_STORE === "file") return "file";
	if (process.platform === "darwin") return "macos-keychain";
	if (process.platform === "win32") return "windows-dpapi";
	return "file";
}

/** Human-readable tier for `capa status`. */
export function describeSecretStoreTier(
	tier: SecretStoreTier = getSecretStoreTier(),
): string {
	if (tier === "file") {
		return "file (Linux fallback — master key is a file under ~/.capa)";
	}
	return tier;
}

function errCode(err: unknown): string | undefined {
	if (typeof err === "object" && err !== null && "code" in err) {
		return (err as { code?: string }).code;
	}
	return undefined;
}

function fileKeyPath(): string {
	return join(getCapaDir(), "master.key");
}

function dpapiKeyPath(): string {
	return join(getCapaDir(), "master.key.dpapi");
}

function ensureCapaDirMode(): void {
	const dir = getCapaDir();
	mkdirSync(dir, { recursive: true });
	if (process.platform !== "win32") {
		chmodSync(dir, 0o700);
	}
}

function readFileKey(path: string): Buffer | null {
	try {
		const buf = readFileSync(path);
		return buf.length === KEY_BYTES ? buf : null;
	} catch (err) {
		if (errCode(err) === "ENOENT") return null;
		throw err;
	}
}

function writeFileKey(path: string, key: Buffer): void {
	writeFileSync(path, key, {
		mode: 0o600,
		flag: process.platform === "win32" ? "w" : "wx",
	});
	if (process.platform !== "win32") {
		chmodSync(path, 0o600);
	}
}

function loadOrCreateFileKey(): Buffer {
	ensureCapaDirMode();
	const path = fileKeyPath();
	const existing = readFileKey(path);
	if (existing) return existing;
	const key = cryptoRandomKey();
	try {
		writeFileKey(path, key);
		return key;
	} catch (err) {
		if (errCode(err) !== "EEXIST") throw err;
		const raced = readFileKey(path);
		if (!raced) throw err;
		return raced;
	}
}

function cryptoRandomKey(): Buffer {
	return randomBytes(KEY_BYTES);
}

function keychainGet(): Buffer | null {
	const result = spawnSync(
		"security",
		["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
		{ encoding: "utf8", windowsHide: true },
	);
	if (result.status !== 0) return null;
	const hex = (result.stdout ?? "").trim();
	if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== KEY_BYTES * 2) return null;
	return Buffer.from(hex, "hex");
}

function keychainSet(key: Buffer): boolean {
	const result = spawnSync(
		"security",
		[
			"add-generic-password",
			"-U",
			"-s",
			KEYCHAIN_SERVICE,
			"-a",
			KEYCHAIN_ACCOUNT,
			"-w",
			key.toString("hex"),
		],
		{ encoding: "utf8", windowsHide: true },
	);
	return result.status === 0;
}

function loadOrCreateKeychainKey(): Buffer | null {
	const existing = keychainGet();
	if (existing) return existing;
	const key = cryptoRandomKey();
	if (!keychainSet(key)) return null;
	return keychainGet() ?? key;
}

function runDpapi(action: "protect" | "unprotect", payload: Buffer): Buffer | null {
	const script =
		action === "protect"
			? `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Convert]::FromBase64String([Console]::In.ReadLine())
$protected = [System.Security.Cryptography.ProtectedData]::Protect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($protected)
`
			: `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Convert]::FromBase64String([Console]::In.ReadLine())
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($plain)
`;
	const result = spawnSync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", script],
		{
			input: `${payload.toString("base64")}\n`,
			encoding: "utf8",
			windowsHide: true,
		},
	);
	if (result.status !== 0) return null;
	const b64 = (result.stdout ?? "").trim().split(/\s+/).pop() ?? "";
	if (!b64) return null;
	try {
		return Buffer.from(b64, "base64");
	} catch {
		return null;
	}
}

function loadOrCreateDpapiKey(): Buffer | null {
	ensureCapaDirMode();
	const path = dpapiKeyPath();
	try {
		const wrapped = readFileSync(path);
		const plain = runDpapi("unprotect", wrapped);
		if (plain && plain.length === KEY_BYTES) return plain;
	} catch (err) {
		if (errCode(err) !== "ENOENT") throw err;
	}
	const key = cryptoRandomKey();
	const wrapped = runDpapi("protect", key);
	if (!wrapped) return null;
	try {
		writeFileSync(path, wrapped, {
			mode: 0o600,
			flag: process.platform === "win32" ? "w" : "wx",
		});
	} catch (err) {
		if (errCode(err) !== "EEXIST") throw err;
		const raced = runDpapi("unprotect", readFileSync(path));
		if (raced && raced.length === KEY_BYTES) return raced;
	}
	return key;
}

/**
 * Load the 256-bit envelope master key. Token rotation never writes here —
 * callers keep this buffer in memory and re-encrypt SQLite rows in place.
 */
export function loadMasterKey(): Buffer {
	if (cachedKey && cachedKey.length === KEY_BYTES) return cachedKey;

	const preferred = getSecretStoreTier();
	let key: Buffer | null = null;
	let tier: SecretStoreTier = preferred;

	if (preferred === "macos-keychain") {
		key = loadOrCreateKeychainKey();
		if (!key) {
			tier = "file";
			key = loadOrCreateFileKey();
		}
	} else if (preferred === "windows-dpapi") {
		key = loadOrCreateDpapiKey();
		if (!key) {
			tier = "file";
			key = loadOrCreateFileKey();
		}
	} else {
		key = loadOrCreateFileKey();
	}

	cachedKey = key;
	cachedTier = tier;
	return key;
}

export function activeSecretStoreTier(): SecretStoreTier {
	if (!cachedTier) loadMasterKey();
	return cachedTier ?? getSecretStoreTier();
}
