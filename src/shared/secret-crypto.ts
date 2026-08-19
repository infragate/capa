import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import {
	encodeSecretAad,
	type SecretBinding,
} from "./secret-binding";
import { resetGitCredentialsForTests } from "./git-credentials";
import {
	loadMasterKey,
	resetSecretStoreForTests,
} from "./secret-store";

export const SECRET_CIPHER_PREFIX_V1 = "enc:v1:";
export const SECRET_CIPHER_PREFIX = "enc:v2:";

export function resetSecretCryptoForTests(): void {
	resetSecretStoreForTests();
	resetGitCredentialsForTests();
}

function isV1Cipher(value: string): boolean {
	return value.startsWith(SECRET_CIPHER_PREFIX_V1);
}

function isV2Cipher(value: string): boolean {
	return value.startsWith(SECRET_CIPHER_PREFIX);
}

function parsePayload(value: string, prefix: string): Buffer {
	return Buffer.from(value.slice(prefix.length), "base64");
}

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * A fresh random 12-byte nonce is generated on every write (never derived,
 * never cached). Reusing a nonce under the same key would leak plaintext and
 * enable GCM forgery — especially bad because tokens rotate often.
 *
 * AAD binds the ciphertext to the SQLite row so a value cannot be relocated
 * into a row someone can read back.
 */
export function encryptSecret(plain: string, binding: SecretBinding): string {
	if (typeof plain !== "string" || plain.length === 0) {
		throw new Error("encryptSecret requires a non-empty string");
	}
	const key = loadMasterKey();
	const iv = randomBytes(12);
	if (iv.length !== 12) {
		throw new Error("GCM nonce must be 12 random bytes");
	}
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(encodeSecretAad(binding));
	const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return SECRET_CIPHER_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptV2(value: string, binding: SecretBinding): string {
	const key = loadMasterKey();
	const buf = parsePayload(value, SECRET_CIPHER_PREFIX);
	if (buf.length < 28) throw new Error("truncated ciphertext");
	const iv = buf.subarray(0, 12);
	const tag = buf.subarray(12, 28);
	const data = buf.subarray(28);
	const decipher = createDecipheriv("aes-256-gcm", key, iv, {
		authTagLength: 16,
	});
	decipher.setAAD(encodeSecretAad(binding));
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function decryptV1(value: string): string {
	const key = loadMasterKey();
	const buf = parsePayload(value, SECRET_CIPHER_PREFIX_V1);
	if (buf.length < 28) throw new Error("truncated ciphertext");
	const iv = buf.subarray(0, 12);
	const tag = buf.subarray(12, 28);
	const data = buf.subarray(28);
	const decipher = createDecipheriv("aes-256-gcm", key, iv, {
		authTagLength: 16,
	});
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function decryptCiphertext(value: string, binding: SecretBinding): string {
	if (isV2Cipher(value)) return decryptV2(value, binding);
	if (isV1Cipher(value)) return decryptV1(value);
	throw new Error("not ciphertext");
}

/** Canonical on-disk form: v2 ciphertext bound to `binding`. */
export function canonicalizeStoredSecret(
	value: string,
	binding: SecretBinding,
): string {
	if (!isV1Cipher(value) && !isV2Cipher(value)) {
		return encryptSecret(value, binding);
	}
	try {
		const plain = decryptCiphertext(value, binding);
		if (isV2Cipher(value)) return value;
		return encryptSecret(plain, binding);
	} catch {
		if (isV2Cipher(value)) throw new Error("ciphertext AAD mismatch");
		return encryptSecret(value, binding);
	}
}

export function decryptSecret(
	value: string | null,
	binding?: SecretBinding,
): string | null {
	if (value === null) return null;
	if (value.length === 0) return value;
	if (isV2Cipher(value)) {
		if (!binding) return null;
		try {
			return decryptV2(value, binding);
		} catch {
			return null;
		}
	}
	if (isV1Cipher(value)) {
		try {
			return decryptV1(value);
		} catch {
			return value;
		}
	}
	return value;
}

export function decryptSecretString(
	value: string,
	binding: SecretBinding,
): string {
	const plain = decryptSecret(value, binding);
	if (plain === null) {
		throw new Error("Failed to decrypt secret: AAD mismatch or corrupt ciphertext");
	}
	return plain;
}

export function secretHint(value: string | undefined): string {
	if (!value || value.length <= 4) return "";
	return value.slice(-4);
}
