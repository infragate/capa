import { randomBytes } from "crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { join } from "path";
import { getCapaDir } from "./config";

/** Active master-key storage backend surfaced in capa status /health. */
export type SecretStorageTier = "keychain" | "dpapi" | "libsecret" | "file";

const KEYRING_SERVICE = "capa";
const KEYRING_ACCOUNT = "master-key";
const FORCE_FILE_ENV = "CAPA_SECRET_STORE";

let cachedKey: Buffer | null = null;
let cachedTier: SecretStorageTier | null = null;

export function resetMasterKeyStoreForTests(): void {
	cachedKey = null;
	cachedTier = null;
}

export function getSecretStorageTier(): SecretStorageTier {
	loadMasterKey();
	return cachedTier ?? "file";
}

export function getMasterKey(): Buffer {
	return loadMasterKey();
}

/** @deprecated Prefer getMasterKey — alias for startup hooks. */
export function preferKeyringMasterKey(): Promise<void> {
	loadMasterKey();
	return Promise.resolve();
}

function masterKeyPath(): string {
	return join(getCapaDir(), "master.key");
}

function errCode(err: unknown): string | undefined {
	if (typeof err === "object" && err !== null && "code" in err) {
		return (err as { code?: string }).code;
	}
	return undefined;
}

function forceFileTier(): boolean {
	return process.env[FORCE_FILE_ENV] === "file";
}

function tierForPlatform(): Exclude<SecretStorageTier, "file"> {
	if (process.platform === "darwin") return "keychain";
	if (process.platform === "win32") return "dpapi";
	return "libsecret";
}

type KeyringEntry = {
	getPassword: () => string | null;
	setPassword: (password: string) => void;
};

function tryOpenKeyring(): KeyringEntry | null {
	if (forceFileTier()) return null;
	try {
		const require = createRequire(import.meta.url);
		const mod = require("@napi-rs/keyring") as {
			Entry: new (service: string, account: string) => {
				getPassword: () => string;
				setPassword: (password: string) => void;
			};
		};
		const entry = new mod.Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
		return {
			getPassword: () => {
				try {
					return entry.getPassword();
				} catch {
					return null;
				}
			},
			setPassword: (password: string) => {
				entry.setPassword(password);
			},
		};
	} catch {
		return null;
	}
}

function readFileKey(): Buffer | null {
	try {
		const buf = readFileSync(masterKeyPath());
		return buf.length === 32 ? buf : null;
	} catch (err) {
		if (errCode(err) !== "ENOENT") throw err;
		return null;
	}
}

function writeFileKey(key: Buffer): void {
	const dir = getCapaDir();
	mkdirSync(dir, { recursive: true });
	if (process.platform !== "win32") {
		chmodSync(dir, 0o700);
	}
	const path = masterKeyPath();
	try {
		writeFileSync(path, key, {
			mode: 0o600,
			flag: process.platform === "win32" ? "w" : "wx",
		});
		if (process.platform !== "win32") {
			chmodSync(path, 0o600);
		}
	} catch (err) {
		if (errCode(err) !== "EEXIST") throw err;
		// Race: another process created the file — caller should re-read.
	}
}

function loadFromFileTier(): Buffer {
	const existing = readFileKey();
	if (existing) {
		cachedKey = existing;
		cachedTier = "file";
		return existing;
	}
	const key = randomBytes(32);
	writeFileKey(key);
	const written = readFileKey();
	cachedKey = written ?? key;
	cachedTier = "file";
	return cachedKey;
}

/**
 * Load (or create) the 256-bit master key.
 * Prefers OS keyring when available; migrates ~/.capa/master.key into the
 * keyring when both are viable; falls back to the file tier otherwise.
 */
export function loadMasterKey(): Buffer {
	if (cachedKey && cachedKey.length === 32 && cachedTier) {
		return cachedKey;
	}

	const keyring = tryOpenKeyring();
	if (keyring) {
		const tier = tierForPlatform();
		const stored = keyring.getPassword();
		if (stored) {
			const buf = Buffer.from(stored, "base64");
			if (buf.length === 32) {
				cachedKey = buf;
				cachedTier = tier;
				return buf;
			}
		}

		// Migrate existing file key, or generate a new one.
		let key = readFileKey();
		if (!key) {
			key = randomBytes(32);
			// Keep a file copy for documented fallback / rollback.
			writeFileKey(key);
			key = readFileKey() ?? key;
		}

		try {
			keyring.setPassword(key.toString("base64"));
			cachedKey = key;
			cachedTier = tier;
			return key;
		} catch {
			// Keyring write failed — stay on file.
			cachedKey = key;
			cachedTier = "file";
			return key;
		}
	}

	return loadFromFileTier();
}
