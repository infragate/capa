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
	opts: { failWrites?: boolean; onRead?: () => void } = {},
) {
	const store = new Map<string, string>();
	const stats = { reads: 0 };
	const Entry = class {
		constructor(
			private service: string,
			private account: string,
		) {}
		getPassword() {
			stats.reads++;
			opts.onRead?.();
			return store.get(`${this.service}/${this.account}`) ?? null;
		}
		setPassword(password: string) {
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
			expect(Buffer.compare(key, file)).toBe(0);
			expect(store.get("capa/master-key")).toBe(file.toString("base64"));
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
