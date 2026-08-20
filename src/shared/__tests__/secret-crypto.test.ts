import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	decryptSecret,
	encryptSecret,
	resetSecretCryptoForTests,
} from "../secret-crypto";

const skipModeAsserts = process.platform === "win32";

describe("secret-crypto", () => {
	let home: string;
	let prevHome: string | undefined;
	let prevProfile: string | undefined;
	let prevStore: string | undefined;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "capa-crypto-home-"));
		prevHome = process.env.HOME;
		prevProfile = process.env.USERPROFILE;
		prevStore = process.env.CAPA_SECRET_STORE;
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		process.env.CAPA_SECRET_STORE = "file";
		resetSecretCryptoForTests();
	});

	afterEach(() => {
		resetSecretCryptoForTests();
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		if (prevProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = prevProfile;
		if (prevStore === undefined) delete process.env.CAPA_SECRET_STORE;
		else process.env.CAPA_SECRET_STORE = prevStore;
		rmSync(home, { recursive: true, force: true });
	});

	it("round-trips plaintext through enc:v1: ciphertext", () => {
		const cipher = encryptSecret("hello-secret");
		expect(cipher.startsWith("enc:v1:")).toBe(true);
		expect(cipher).not.toContain("hello-secret");
		expect(decryptSecret(cipher)).toBe("hello-secret");
	});

	it("returns legacy plaintext unchanged", () => {
		expect(decryptSecret("legacy-plain-token")).toBe("legacy-plain-token");
	});

	it("treats a legacy plaintext value that starts with enc:v1: as plaintext", () => {
		expect(decryptSecret("enc:v1:this-is-not-ciphertext")).toBe(
			"enc:v1:this-is-not-ciphertext",
		);
	});

	it("creates ~/.capa/master.key with mode 0600", () => {
		encryptSecret("x");
		const keyPath = join(home, ".capa", "master.key");
		expect(existsSync(keyPath)).toBe(true);
		expect(readFileSync(keyPath).length).toBe(32);
		if (!skipModeAsserts) {
			expect(statSync(keyPath).mode & 0o777).toBe(0o600);
		}
	});
});
