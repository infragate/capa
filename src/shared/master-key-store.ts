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

/**
 * Report the active (or preferred) storage tier without creating or migrating
 * a master key. Used by `capa status` so a read-only check stays read-only.
 */
export function peekSecretStorageTier(): SecretStorageTier {
	if (cachedTier) return cachedTier;
	if (forceFileTier()) return "file";

	const keyring = tryOpenKeyring();
	if (keyring && keyringKeyInUse(keyring, readFileKey())) {
		return tierForPlatform();
	}
	return "file";
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

type KeyringModule = {
	Entry: new (
		service: string,
		account: string,
	) => {
		getPassword: () => string | null;
		setPassword: (password: string) => void;
	};
};

/**
 * macOS gate: compiled macOS binaries stay on the file tier until releases are
 * code signed, since an unsigned (or re-signed per upgrade) binary can trigger
 * Keychain access prompts. Flip to true once signing is in place.
 */
const MACOS_COMPILED_KEYCHAIN = false;

/** True when running from a `bun build --compile` binary (embedded bunfs). */
function isCompiledBinary(): boolean {
	return (
		import.meta.path.includes("$bunfs") || import.meta.path.includes("~BUN")
	);
}

export function keyringAllowed(
	platform: NodeJS.Platform = process.platform,
	compiled: boolean = isCompiledBinary(),
): boolean {
	return platform !== "darwin" || !compiled || MACOS_COMPILED_KEYCHAIN;
}

function loadKeyringModule(): KeyringModule {
	try {
		// Generated per build target by scripts/generate-keyring-addon.ts so the
		// compiled binary embeds the native addon. Absent when running from source.
		return require("./keyring-addon").default;
	} catch {
		return createRequire(import.meta.url)("@napi-rs/keyring");
	}
}

let keyringModuleLoader: () => KeyringModule = loadKeyringModule;

/** Swap the keyring module (pass null to restore the real one). */
export function setKeyringModuleLoaderForTests(
	loader: (() => KeyringModule) | null,
): void {
	keyringModuleLoader = loader ?? loadKeyringModule;
}

function tryOpenKeyring(): KeyringEntry | null {
	if (forceFileTier() || !keyringAllowed()) return null;
	try {
		const mod = keyringModuleLoader();
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
 * The keyring key, if it is the one in use: either there is no file key, or
 * the file is the rollback copy of that same key. A file key that differs (or
 * has no keyring counterpart) means an existing file-tier install, which keeps
 * the file so upgrades never change which key encrypts existing secrets.
 */
function keyringKeyInUse(
	keyring: KeyringEntry,
	fileKey: Buffer | null,
): Buffer | null {
	const stored = keyring.getPassword();
	if (!stored) return null;
	const buf = Buffer.from(stored, "base64");
	if (buf.length !== 32) return null;
	return !fileKey || buf.equals(fileKey) ? buf : null;
}

/**
 * Load (or create) the 256-bit master key.
 * Uses the OS keyring when it holds the key in use (see keyringKeyInUse). An
 * existing ~/.capa/master.key otherwise keeps the file tier and is never
 * migrated. Only a new install (no key anywhere) goes to the keyring, with a
 * file copy kept for rollback.
 */
export function loadMasterKey(): Buffer {
	if (cachedKey && cachedKey.length === 32 && cachedTier) {
		return cachedKey;
	}

	const keyring = tryOpenKeyring();
	if (keyring) {
		const tier = tierForPlatform();
		const fileKey = readFileKey();
		const inKeyring = keyringKeyInUse(keyring, fileKey);
		if (inKeyring) {
			cachedKey = inKeyring;
			cachedTier = tier;
			return inKeyring;
		}

		if (!fileKey) {
			// New install: generate, keep a file copy for fallback / rollback.
			let key: Buffer = randomBytes(32);
			writeFileKey(key);
			key = readFileKey() ?? key;
			try {
				keyring.setPassword(key.toString("base64"));
				cachedKey = key;
				cachedTier = tier;
				return key;
			} catch {
				// Keyring write failed: stay on file.
				cachedKey = key;
				cachedTier = "file";
				return key;
			}
		}
	}

	return loadFromFileTier();
}
