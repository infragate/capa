import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	getMasterKey,
	getSecretStorageTier,
	keyringAllowed,
	peekSecretStorageTier,
	resetMasterKeyStoreForTests,
	setKeyringModuleLoaderForTests,
} from "../master-key-store";

const platformTier =
	process.platform === "darwin"
		? "keychain"
		: process.platform === "win32"
			? "dpapi"
			: "libsecret";

/** In-memory stand-in for @napi-rs/keyring so tests never touch the OS store. */
function fakeKeyring(
	opts: { failWrites?: boolean; failReads?: boolean; onRead?: () => void } = {},
) {
	const store = new Map<string, string>();
	const stats = { reads: 0, writes: 0, options: undefined as unknown };
	const Entry = class {
		constructor(
			private service: string,
			private account: string,
			options?: unknown,
		) {
			stats.options = options;
		}
		getPassword() {
			stats.reads++;
			opts.onRead?.();
			if (opts.failReads) throw new Error("keyring is locked");
			return store.get(`${this.service}/${this.account}`) ?? null;
		}
		setPassword(password: string) {
			stats.writes++;
			if (opts.failWrites) throw new Error("no secret service");
			store.set(`${this.service}/${this.account}`, password);
		}
	};
	return { store, stats, loader: () => ({ Entry }) };
}

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
		setKeyringModuleLoaderForTests(null);
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

	it("peekSecretStorageTier does not create a master key", () => {
		expect(peekSecretStorageTier()).toBe("file");
		expect(existsSync(join(home, ".capa", "master.key"))).toBe(false);
		expect(existsSync(join(home, ".capa"))).toBe(false);
	});

	describe("tier selection", () => {
		beforeEach(() => {
			delete process.env.CAPA_SECRET_STORE;
		});

		it("new install stores the key in the keyring and keeps a file copy", () => {
			const { store, stats, loader } = fakeKeyring();
			setKeyringModuleLoaderForTests(loader);
			const key = getMasterKey();
			expect(getSecretStorageTier()).toBe(platformTier);
			expect(store.get("capa/master-key")).toBe(key.toString("base64"));
			const file = readFileSync(join(home, ".capa", "master.key"));
			expect(Buffer.compare(file, key)).toBe(0);
			// Linux: Secret Service only, never the non-durable kernel keyring.
			expect(stats.options).toEqual({ linux: { store: "secret-service" } });

			// Next start uses the file copy and never reads the keyring, which
			// could prompt (locked GNOME keyring); the marker keeps the tier.
			resetMasterKeyStoreForTests();
			const readsBefore = stats.reads;
			expect(peekSecretStorageTier()).toBe(platformTier);
			expect(Buffer.compare(getMasterKey(), key)).toBe(0);
			expect(getSecretStorageTier()).toBe(platformTier);
			expect(stats.reads).toBe(readsBefore);
		});

		it("an existing master.key keeps the file tier and is never migrated", () => {
			const dir = join(home, ".capa");
			mkdirSync(dir, { recursive: true });
			const seeded = Buffer.alloc(32, 9);
			writeFileSync(join(dir, "master.key"), seeded);
			const { store, stats, loader } = fakeKeyring();
			setKeyringModuleLoaderForTests(loader);

			expect(peekSecretStorageTier()).toBe("file");
			expect(Buffer.compare(getMasterKey(), seeded)).toBe(0);
			expect(getSecretStorageTier()).toBe("file");
			expect(store.size).toBe(0);
			expect(stats.reads).toBe(0);
		});

		it("a master.key that differs from the keyring key wins", () => {
			const dir = join(home, ".capa");
			mkdirSync(dir, { recursive: true });
			const seeded = Buffer.alloc(32, 9);
			writeFileSync(join(dir, "master.key"), seeded);
			const { store, loader } = fakeKeyring();
			store.set("capa/master-key", Buffer.alloc(32, 1).toString("base64"));
			setKeyringModuleLoaderForTests(loader);

			expect(peekSecretStorageTier()).toBe("file");
			expect(Buffer.compare(getMasterKey(), seeded)).toBe(0);
			expect(getSecretStorageTier()).toBe("file");
		});

		it("stores the key that won master.key when another process races", () => {
			// Another process creates master.key right after this one checked.
			const dir = join(home, ".capa");
			const other = Buffer.alloc(32, 7);
			const { store, loader } = fakeKeyring({
				onRead: () => {
					mkdirSync(dir, { recursive: true });
					if (!existsSync(join(dir, "master.key"))) {
						writeFileSync(join(dir, "master.key"), other);
					}
				},
			});
			setKeyringModuleLoaderForTests(loader);

			const key = getMasterKey();
			const file = readFileSync(join(dir, "master.key"));
			expect(key.equals(other)).toBe(true);
			expect(file.equals(other)).toBe(true);
			expect(store.get("capa/master-key")).toBe(other.toString("base64"));
		});

		it("repairs a corrupt master.key from the keyring copy", () => {
			const dir = join(home, ".capa");
			mkdirSync(dir, { recursive: true });
			const good = Buffer.alloc(32, 5);
			writeFileSync(join(dir, "master.key"), "");
			writeFileSync(join(dir, "master.key.keyring"), "");
			const { store, stats, loader } = fakeKeyring();
			store.set("capa/master-key", good.toString("base64"));
			setKeyringModuleLoaderForTests(loader);

			expect(getMasterKey().equals(good)).toBe(true);
			expect(readFileSync(join(dir, "master.key")).equals(good)).toBe(true);
			expect(getSecretStorageTier()).toBe(platformTier);
			expect(stats.writes).toBe(0);
			expect(readdirSync(dir).sort()).toEqual([
				"master.key",
				"master.key.keyring",
			]);
		});

		it("waits for a master.key another process is still writing", async () => {
			const dir = join(home, ".capa");
			mkdirSync(dir, { recursive: true });
			const path = join(dir, "master.key");
			const key = Buffer.alloc(32, 5);
			writeFileSync(path, key.subarray(0, 8));
			// A separate process finishes the write while this one is reading.
			const writer = Bun.spawn([
				process.execPath,
				"-e",
				`await Bun.sleep(200); require("fs").writeFileSync(${JSON.stringify(path)}, Buffer.alloc(32, 5));`,
			]);
			await Bun.sleep(50);
			expect(Buffer.compare(getMasterKey(), key)).toBe(0);
			await writer.exited;
		});

		it("refuses a corrupt master.key it can't repair", () => {
			const dir = join(home, ".capa");
			mkdirSync(dir, { recursive: true });
			const path = join(dir, "master.key");
			// Longer than a key, so it is corrupt without waiting for a writer.
			writeFileSync(path, "x".repeat(40));
			writeFileSync(join(dir, "master.key.keyring"), "");

			// No keyring copy.
			const empty = fakeKeyring();
			setKeyringModuleLoaderForTests(empty.loader);
			expect(() => getMasterKey()).toThrow(/not a valid 32-byte key/);
			expect(empty.stats.writes).toBe(0);

			// Keyring read failure.
			setKeyringModuleLoaderForTests(fakeKeyring({ failReads: true }).loader);
			resetMasterKeyStoreForTests();
			expect(() => getMasterKey()).toThrow(/not a valid 32-byte key/);

			// A keyring key but no marker: it was never this file's copy.
			const other = fakeKeyring();
			other.store.set(
				"capa/master-key",
				Buffer.alloc(32, 3).toString("base64"),
			);
			setKeyringModuleLoaderForTests(other.loader);
			rmSync(join(dir, "master.key.keyring"));
			resetMasterKeyStoreForTests();
			expect(() => getMasterKey()).toThrow(/not a valid 32-byte key/);
			expect(other.stats.reads).toBe(0);

			// File tier only (no keyring at all).
			process.env.CAPA_SECRET_STORE = "file";
			resetMasterKeyStoreForTests();
			expect(() => getMasterKey()).toThrow(/not a valid 32-byte key/);

			expect(readFileSync(path, "utf8")).toBe("x".repeat(40));
		});

		it("never writes the keyring after a failed read", () => {
			const { store, stats, loader } = fakeKeyring({ failReads: true });
			const backup = Buffer.alloc(32, 4).toString("base64");
			store.set("capa/master-key", backup);
			setKeyringModuleLoaderForTests(loader);

			const key = getMasterKey();
			expect(getSecretStorageTier()).toBe("file");
			expect(stats.writes).toBe(0);
			expect(store.get("capa/master-key")).toBe(backup);
			const dir = join(home, ".capa");
			expect(readFileSync(join(dir, "master.key")).equals(key)).toBe(true);
			expect(existsSync(join(dir, "master.key.keyring"))).toBe(false);
		});

		it("falls back to the file tier when the addon can't load", () => {
			setKeyringModuleLoaderForTests(() => {
				throw new Error("Cannot find native binding");
			});
			expect(getMasterKey().length).toBe(32);
			expect(getSecretStorageTier()).toBe("file");
			expect(existsSync(join(home, ".capa", "master.key"))).toBe(true);
		});

		it("falls back to the file tier when the keyring rejects writes", () => {
			const { loader } = fakeKeyring({ failWrites: true });
			setKeyringModuleLoaderForTests(loader);
			const key = getMasterKey();
			expect(getSecretStorageTier()).toBe("file");
			resetMasterKeyStoreForTests();
			expect(Buffer.compare(getMasterKey(), key)).toBe(0);
			expect(getSecretStorageTier()).toBe("file");
		});
	});

	describe("keyringAllowed", () => {
		it("keeps compiled macOS builds off the keychain", () => {
			expect(keyringAllowed("darwin", true)).toBe(false);
		});

		it("allows macOS from source and compiled Windows/Linux", () => {
			expect(keyringAllowed("darwin", false)).toBe(true);
			expect(keyringAllowed("win32", true)).toBe(true);
			expect(keyringAllowed("linux", true)).toBe(true);
		});
	});
});
