import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getCapaDir } from "./config";

const PREFIX = "enc:v1:";
let cachedKey: Buffer | null = null;

export function resetSecretCryptoForTests(): void {
	cachedKey = null;
}

function masterKeyPath(): string {
	return join(getCapaDir(), "master.key");
}

function loadMasterKey(): Buffer {
	if (cachedKey && cachedKey.length === 32) return cachedKey;
	const dir = getCapaDir();
	mkdirSync(dir, { recursive: true });
	try {
		chmodSync(dir, 0o700);
	} catch {
		// win32
	}
	const path = masterKeyPath();
	if (existsSync(path)) {
		cachedKey = readFileSync(path);
		return cachedKey;
	}
	const key = randomBytes(32);
	writeFileSync(path, key, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		// win32
	}
	cachedKey = key;
	return key;
}

export function encryptSecret(plain: string): string {
	const key = loadMasterKey();
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(value: string): string {
	if (!value.startsWith(PREFIX)) return value;
	const key = loadMasterKey();
	const buf = Buffer.from(value.slice(PREFIX.length), "base64");
	const iv = buf.subarray(0, 12);
	const tag = buf.subarray(12, 28);
	const data = buf.subarray(28);
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString(
		"utf8",
	);
}

export const decryptSecretString = decryptSecret;
export function secretHint(value: string | undefined): string {
	if (!value) return "";
	return value.length > 4 ? value.slice(-4) : "";
}

export function secretHint(value: string): string {
	if (value.length <= 4) return "";
	return value.slice(-4);
}

export function encryptSecretIfNeeded(
	value: string | null | undefined,
): string | null {
	if (value == null) return null;
	if (value.startsWith(PREFIX)) return value;
	return encryptSecret(value);
}
