import { randomBytes } from "crypto";
import {
	chmodSync,
	existsSync,
	linkSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "fs";
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

	if (readFileKey() !== "missing") return fileKeyTier();
	const keyring = tryOpenKeyring();
	return keyring && keyringKey(keyring) ? tierForPlatform() : "file";
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

/** Present when the file key is the rollback copy of a key in the OS keyring. */
function keyringMarkerPath(): string {
	return join(getCapaDir(), "master.key.keyring");
}

function fileKeyTier(): SecretStorageTier {
	return existsSync(keyringMarkerPath()) && !forceFileTier() && keyringAllowed()
		? tierForPlatform()
		: "file";
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
	/** The stored value; null when there is none, undefined when the read failed. */
	getPassword: () => string | null | undefined;
	setPassword: (password: string) => void;
};

type KeyringModule = {
	Entry: new (
		service: string,
		account: string,
		options?: { linux?: { store?: "secret-service" | "keyutils" } },
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
		// Linux: Secret Service only. The default falls back to the kernel
		// keyring, which doesn't survive a reboot, so headless Linux uses the
		// file tier instead of a backup that silently disappears.
		const entry = new mod.Entry(KEYRING_SERVICE, KEYRING_ACCOUNT, {
			linux: { store: "secret-service" },
		});
		return {
			getPassword: () => {
				try {
					return entry.getPassword();
				} catch {
					return undefined;
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

/** How long a short master.key may still be mid-write by another process. */
const PARTIAL_KEY_WAIT_MS = 1000;
const PARTIAL_KEY_POLL_MS = 25;

function fileMtimeMs(): number {
	try {
		return statSync(masterKeyPath()).mtimeMs;
	} catch {
		return 0;
	}
}

/**
 * master.key's key, or whether the file is missing or holds something else.
 * A file shorter than a key may be another process's create-new write in
 * progress (the fallback when hard links aren't available), so it is re-read
 * for up to PARTIAL_KEY_WAIT_MS before it counts as invalid.
 */
function readFileKey(): Buffer | "missing" | "invalid" {
	const deadline = Date.now() + PARTIAL_KEY_WAIT_MS;
	for (;;) {
		let buf: Buffer;
		try {
			buf = readFileSync(masterKeyPath());
		} catch (err) {
			if (errCode(err) !== "ENOENT") throw err;
			return "missing";
		}
		if (buf.length === 32) return buf;
		if (buf.length > 32 || Date.now() >= deadline) return "invalid";
		// Only a file written just now can be another process's write in
		// progress; a short file that has sat there is corrupt, and waiting on
		// it would stall every key load (e.g. each /health request).
		if (Date.now() - fileMtimeMs() > PARTIAL_KEY_WAIT_MS) return "invalid";
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, PARTIAL_KEY_POLL_MS);
	}
}

function invalidFileKeyError(): Error {
	return new Error(
		`${masterKeyPath()} is not a valid 32-byte key and can't be repaired from the OS keyring. ` +
			"Restore it from a backup, or delete it to start over (secrets capa already stored will be unreadable).",
	);
}

/**
 * Re-read master.key. A process only ever uses the key that is on disk: the
 * startup migration re-encrypts every secret under the key in use, so a key
 * that isn't persisted would make them all unrecoverable.
 */
function settledFileKey(): Buffer {
	const key = readFileKey();
	if (!Buffer.isBuffer(key)) throw invalidFileKeyError();
	return key;
}

/** Write key to a new 0600 temp file next to master.key; returns its path. */
function writeTempKey(key: Buffer): string {
	const dir = getCapaDir();
	mkdirSync(dir, { recursive: true });
	if (process.platform !== "win32") {
		chmodSync(dir, 0o700);
	}
	const tmp = join(
		dir,
		`master.key.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
	);
	writeFileSync(tmp, key, { mode: 0o600, flag: "wx" });
	return tmp;
}

function removeQuietly(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// A stray temp file sits in the same 0700 dir as master.key.
	}
}

/**
 * Create master.key holding key unless it already exists, then return what
 * master.key holds. When processes initialize together the first one to
 * create the file wins and every process uses its key. The file is linked in
 * from a complete temp file so no reader ever sees a partial master.key.
 */
function createFileKey(key: Buffer): Buffer {
	const path = masterKeyPath();
	const tmp = writeTempKey(key);
	try {
		linkSync(tmp, path);
	} catch (err) {
		if (errCode(err) !== "EEXIST") {
			// No hard links on this filesystem: plain create-new instead.
			try {
				writeFileSync(path, key, { mode: 0o600, flag: "wx" });
			} catch (err2) {
				if (errCode(err2) !== "EEXIST") throw err2;
			}
		}
	} finally {
		removeQuietly(tmp);
	}
	return settledFileKey();
}

/**
 * master.key exists but isn't a key (e.g. truncated by a crash or a full
 * disk). Only a keyring install (marker present) has a copy to restore from;
 * anything else fails closed rather than inventing a key, which would get the
 * existing secrets re-encrypted under it.
 */
function repairFileKey(): Buffer {
	const keyring = existsSync(keyringMarkerPath()) ? tryOpenKeyring() : null;
	const stored = keyring ? keyringKey(keyring) : null;
	if (!stored) throw invalidFileKeyError();
	const tmp = writeTempKey(stored);
	try {
		renameSync(tmp, masterKeyPath());
	} catch (err) {
		removeQuietly(tmp);
		throw err;
	}
	return settledFileKey();
}

function loadFromFileTier(): Buffer {
	cachedKey = createFileKey(randomBytes(32));
	cachedTier = "file";
	return cachedKey;
}

/** The keyring's key; null when it holds none, undefined when the read failed. */
function keyringKey(keyring: KeyringEntry): Buffer | null | undefined {
	const stored = keyring.getPassword();
	if (stored === undefined) return undefined;
	if (!stored) return null;
	const buf = Buffer.from(stored, "base64");
	return buf.length === 32 ? buf : null;
}

/**
 * Load (or create) the 256-bit master key.
 *
 * An existing ~/.capa/master.key is always the key in use: a keyring install
 * keeps an identical file copy, so the keyring is never read when the file
 * exists. Reading it can prompt (e.g. a locked GNOME keyring), and upgrades
 * must not prompt or move where existing secrets' key lives.
 *
 * Only a new install (no file key) uses the keyring: it adopts a key already
 * stored there or generates one, writes the file copy for rollback, and leaves
 * a marker so later starts report the keyring tier without touching it.
 */
export function loadMasterKey(): Buffer {
	if (cachedKey && cachedKey.length === 32 && cachedTier) {
		return cachedKey;
	}

	const fileKey = readFileKey();
	if (fileKey === "invalid") {
		cachedKey = repairFileKey();
		cachedTier = fileKeyTier();
		return cachedKey;
	}
	if (fileKey !== "missing") {
		cachedKey = fileKey;
		cachedTier = fileKeyTier();
		return fileKey;
	}

	const keyring = tryOpenKeyring();
	if (!keyring) return loadFromFileTier();

	const stored = keyringKey(keyring);
	// A failed read (locked keyring, D-Bus timeout) isn't "no key": the keyring
	// may hold the only backup, so never write to it after one.
	if (stored === undefined) return loadFromFileTier();

	// Settle the file first: when processes initialize together, the key that
	// wins master.key is the one in use, so only that key goes to the keyring.
	const key = createFileKey(stored ?? randomBytes(32));
	let inKeyring = stored?.equals(key) ?? false;
	if (!inKeyring) {
		try {
			keyring.setPassword(key.toString("base64"));
			inKeyring = true;
		} catch {
			// Keyring write failed: stay on file.
		}
	}
	if (inKeyring) writeFileSync(keyringMarkerPath(), "");
	cachedKey = key;
	cachedTier = inKeyring ? tierForPlatform() : "file";
	return key;
}
