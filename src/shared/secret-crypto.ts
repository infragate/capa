import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getCapaDir } from "./config";

export const SECRET_CIPHER_PREFIX = "enc:v1:";
let cachedKey: Buffer | null = null;

export function resetSecretCryptoForTests(): void {
	cachedKey = null;
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

function loadMasterKey(): Buffer {
	if (cachedKey && cachedKey.length === 32) return cachedKey;
	const dir = getCapaDir();
	mkdirSync(dir, { recursive: true });
	if (process.platform !== "win32") {
		chmodSync(dir, 0o700);
	}
	const path = masterKeyPath();
	try {
		cachedKey = readFileSync(path);
		return cachedKey;
	} catch (err) {
		if (errCode(err) !== "ENOENT") throw err;
	}
	const key = randomBytes(32);
	try {
		writeFileSync(path, key, {
			mode: 0o600,
			flag: process.platform === "win32" ? "w" : "wx",
		});
		if (process.platform !== "win32") {
			chmodSync(path, 0o600);
		}
		cachedKey = key;
		return key;
	} catch (err) {
		if (errCode(err) !== "EEXIST") throw err;
		cachedKey = readFileSync(path);
		return cachedKey;
	}
}

export function encryptSecret(plain: string): string {
	const key = loadMasterKey();
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return (
		SECRET_CIPHER_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64")
	);
}

function decryptCiphertext(value: string): string {
	const key = loadMasterKey();
	const buf = Buffer.from(value.slice(SECRET_CIPHER_PREFIX.length), "base64");
	const iv = buf.subarray(0, 12);
	const tag = buf.subarray(12, 28);
	const data = buf.subarray(28);
	const decipher = createDecipheriv("aes-256-gcm", key, iv, {
		authTagLength: 16,
	});
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString(
		"utf8",
	);
}

/** Canonical on-disk form: ciphertext, or encrypt legacy / colliding plaintext. */
export function canonicalizeStoredSecret(value: string): string {
	if (!value.startsWith(SECRET_CIPHER_PREFIX)) return encryptSecret(value);
	try {
		decryptCiphertext(value);
		return value;
	} catch {
		return encryptSecret(value);
	}
}

export function decryptSecret(value: string | null): string | null {
	if (value === null) return null;
	if (!value.startsWith(SECRET_CIPHER_PREFIX)) return value;
	try {
		return decryptCiphertext(value);
	} catch {
		return value;
	}
}

export function decryptSecretString(value: string): string {
	return decryptSecret(value) as string;
}

export function secretHint(value: string | undefined): string {
	if (!value || value.length <= 4) return "";
	return value.slice(-4);
}
