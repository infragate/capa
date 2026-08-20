import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import {
	getMasterKey,
	getSecretStorageTier,
	preferKeyringMasterKey,
	resetMasterKeyStoreForTests,
	type SecretStorageTier,
} from "./master-key-store";

export const SECRET_CIPHER_PREFIX = "enc:v1:";

export type { SecretStorageTier };
export { getSecretStorageTier, preferKeyringMasterKey };

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
