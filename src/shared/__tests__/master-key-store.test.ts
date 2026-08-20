import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	getMasterKey,
	getSecretStorageTier,
	resetMasterKeyStoreForTests,
} from "../master-key-store";

describe("master-key-store", () => {
	let home: string;
	let prevHome: string | undefined;
	let prevProfile: string | undefined;
	let prevStore: string | undefined;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "capa-master-key-"));
		prevHome = process.env.HOME;
		prevProfile = process.env.USERPROFILE;
		prevStore = process.env.CAPA_SECRET_STORE;
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		process.env.CAPA_SECRET_STORE = "file";
		resetMasterKeyStoreForTests();
	});

	afterEach(() => {
		resetMasterKeyStoreForTests();
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		if (prevProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = prevProfile;
		if (prevStore === undefined) delete process.env.CAPA_SECRET_STORE;
		else process.env.CAPA_SECRET_STORE = prevStore;
		rmSync(home, { recursive: true, force: true });
	});

	it("creates a 32-byte file key and reports file tier when forced", () => {
		const key = getMasterKey();
		expect(key.length).toBe(32);
		expect(getSecretStorageTier()).toBe("file");
		const path = join(home, ".capa", "master.key");
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path).length).toBe(32);
	});

	it("reuses an existing file key", () => {
		const first = getMasterKey();
		resetMasterKeyStoreForTests();
		const second = getMasterKey();
		expect(Buffer.compare(first, second)).toBe(0);
	});

	it("loads a pre-seeded master.key", () => {
		const dir = join(home, ".capa");
		mkdirSync(dir, { recursive: true });
		const seeded = Buffer.alloc(32, 7);
		writeFileSync(join(dir, "master.key"), seeded);
		resetMasterKeyStoreForTests();
		expect(Buffer.compare(getMasterKey(), seeded)).toBe(0);
	});
});
