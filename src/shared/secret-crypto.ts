import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import {
	getMasterKey,
	getSecretStorageTier,
	peekSecretStorageTier,
	preferKeyringMasterKey,
	resetMasterKeyStoreForTests,
	type SecretStorageTier,
} from "./master-key-store";

export const SECRET_CIPHER_PREFIX = "enc:v1:";

export type { SecretStorageTier };
export { getSecretStorageTier, peekSecretStorageTier, preferKeyringMasterKey };

export function resetSecretCryptoForTests(): void {
	resetMasterKeyStoreForTests();
}

export function encryptSecret(plain: string): string {
	const key = getMasterKey();
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return (
		SECRET_CIPHER_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64")
	);
}

function decryptCiphertext(value: string): string {
	const key = getMasterKey();
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

/** IV (12) + auth tag (16) + at least one byte of data, base64 after the prefix. */
const MIN_CIPHER_BYTES = 12 + 16 + 1;

/** True when `value` has the shape encryptSecret produces (not whether it decrypts). */
function isCipherEnvelope(value: string): boolean {
	if (!value.startsWith(SECRET_CIPHER_PREFIX)) return false;
	const body = value.slice(SECRET_CIPHER_PREFIX.length);
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length % 4 !== 0) return false;
	return Buffer.from(body, "base64").length >= MIN_CIPHER_BYTES;
}

/**
 * Canonical on-disk form: encrypt legacy plaintext, keep ciphertext as is.
 * Ciphertext that does not decrypt (wrong master key) is never re-encrypted:
 * that would lock it under the wrong key for good. It stays byte-identical
 * and is reported as `undecryptable`, so restoring the right key recovers it.
 */
export function canonicalizeStoredSecret(value: string): {
	value: string;
	undecryptable: boolean;
} {
	// Legacy plaintext that merely starts with the prefix is still plaintext.
	if (!isCipherEnvelope(value)) {
		return { value: encryptSecret(value), undecryptable: false };
	}
	try {
		decryptCiphertext(value);
		return { value, undecryptable: false };
	} catch {
		return { value, undecryptable: true };
	}
}

export function decryptSecret(value: string | null | undefined): string | null {
	if (value == null) return null;
	if (!value.startsWith(SECRET_CIPHER_PREFIX)) return value;
	try {
		return decryptCiphertext(value);
	} catch {
		return value;
	}
}

export function decryptSecretString(value: string | null | undefined): string {
	const decrypted = decryptSecret(value);
	return decrypted ?? "";
}

export function secretHint(value: string | undefined): string {
	if (!value || value.length <= 4) return "";
	return value.slice(-4);
}
