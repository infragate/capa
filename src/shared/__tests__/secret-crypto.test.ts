import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { oauthSecretBinding, variableSecretBinding } from "../secret-binding";
import {
	SECRET_CIPHER_PREFIX,
	decryptSecret,
	encryptSecret,
	resetSecretCryptoForTests,
} from "../secret-crypto";
import {
	activeSecretStoreTier,
	describeSecretStoreTier,
} from "../secret-store";

const skipModeAsserts = process.platform === "win32";

describe("secret-crypto", () => {
	let home: string;
	let prevHome: string | undefined;
	let prevProfile: string | undefined;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "capa-crypto-home-"));
		prevHome = process.env.HOME;
		prevProfile = process.env.USERPROFILE;
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		resetSecretCryptoForTests();
	});

	afterEach(() => {
		resetSecretCryptoForTests();
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		if (prevProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = prevProfile;
		rmSync(home, { recursive: true, force: true });
	});

	const binding = variableSecretBinding("p1", "API_KEY");

	it("round-trips plaintext through enc:v2: ciphertext", () => {
		const cipher = encryptSecret("hello-secret", binding);
		expect(cipher.startsWith(SECRET_CIPHER_PREFIX)).toBe(true);
		expect(cipher).not.toContain("hello-secret");
		expect(decryptSecret(cipher, binding)).toBe("hello-secret");
	});

	it("uses a fresh random 12-byte nonce on every write", () => {
		const a = encryptSecret("same-plain", binding);
		const b = encryptSecret("same-plain", binding);
		expect(a).not.toBe(b);
		const payloadA = Buffer.from(a.slice(SECRET_CIPHER_PREFIX.length), "base64");
		const payloadB = Buffer.from(b.slice(SECRET_CIPHER_PREFIX.length), "base64");
		expect(payloadA.subarray(0, 12).equals(payloadB.subarray(0, 12))).toBe(false);
	});

	it("refuses to decrypt a ciphertext relocated to another row", () => {
		const cipher = encryptSecret("row-secret", binding);
		expect(
			decryptSecret(cipher, variableSecretBinding("p1", "OTHER_KEY")),
		).toBeNull();
		expect(
			decryptSecret(cipher, oauthSecretBinding("p1", "svc", "access_token")),
		).toBeNull();
		expect(decryptSecret(cipher, binding)).toBe("row-secret");
	});

	it("returns legacy plaintext unchanged", () => {
		expect(decryptSecret("legacy-plain-token", binding)).toBe(
			"legacy-plain-token",
		);
	});

	it("treats a legacy plaintext value that starts with enc:v1: as plaintext", () => {
		expect(decryptSecret("enc:v1:this-is-not-ciphertext", binding)).toBe(
			"enc:v1:this-is-not-ciphertext",
		);
	});

	it("creates ~/.capa/master.key with mode 0600 on the file fallback tier", () => {
		encryptSecret("x", binding);
		expect(activeSecretStoreTier()).toBe("file");
		expect(describeSecretStoreTier("file")).toContain("Linux fallback");
		const keyPath = join(home, ".capa", "master.key");
		expect(existsSync(keyPath)).toBe(true);
		expect(readFileSync(keyPath).length).toBe(32);
		if (!skipModeAsserts) {
			expect(statSync(keyPath).mode & 0o777).toBe(0o600);
		}
	});
});
