import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CapaDatabase } from "../database";
import { resetSecretCryptoForTests } from "../../shared/secret-crypto";

const skipModeAsserts = process.platform === "win32";
const SECRET = "capa-at-rest-secret-VALUE-7kL9";

describe("credential at-rest encryption", () => {
	let home: string;
	let dbPath: string;
	let db: CapaDatabase;
	let prevHome: string | undefined;
	let prevProfile: string | undefined;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "capa-at-rest-"));
		prevHome = process.env.HOME;
		prevProfile = process.env.USERPROFILE;
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		resetSecretCryptoForTests();
		dbPath = join(home, "test.db");
		db = new CapaDatabase(dbPath);
		db.upsertProject({ id: "p1", path: "/p1" });
	});

	afterEach(() => {
		db.close();
		resetSecretCryptoForTests();
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		if (prevProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = prevProfile;
		try {
			rmSync(home, { recursive: true, force: true });
		} catch {
			// Windows can keep capa.db locked briefly after close
		}
	});

	it("chmods the sqlite file to 0600", () => {
		if (skipModeAsserts) return;
		expect(statSync(dbPath).mode & 0o777).toBe(0o600);
	});

	it("encrypts variable values so the db file does not contain the raw secret", () => {
		db.setVariable("p1", "API_KEY", SECRET);
		expect(db.getVariable("p1", "API_KEY")).toBe(SECRET);

		db.close();
		const bytes = readFileSync(dbPath);
		expect(bytes.includes(Buffer.from(SECRET))).toBe(false);

		const raw = new Database(dbPath, { readonly: true });
		const row = raw
			.query("SELECT value FROM variables WHERE project_id = ? AND key = ?")
			.get("p1", "API_KEY") as { value: string };
		raw.close();
		expect(row.value.startsWith("enc:v2:")).toBe(true);
		expect(row.value).not.toContain(SECRET);

		db = new CapaDatabase(dbPath);
		expect(db.getVariable("p1", "API_KEY")).toBe(SECRET);
	});

	it("still reads legacy plaintext variable rows", () => {
		const raw = new Database(dbPath);
		raw.run(
			"INSERT INTO variables (project_id, key, value, created_at) VALUES (?, ?, ?, ?)",
			["p1", "LEGACY", "plain-legacy-token", Date.now()],
		);
		raw.close();
		expect(db.getVariable("p1", "LEGACY")).toBe("plain-legacy-token");
	});

	it("rewrites legacy plaintext rows to ciphertext on the next open", () => {
		db.close();
		const raw = new Database(dbPath);
		raw.run(
			"INSERT INTO variables (project_id, key, value, created_at) VALUES (?, ?, ?, ?)",
			["p1", "MIGRATE_ME", "plain-to-migrate", Date.now()],
		);
		raw.close();

		db = new CapaDatabase(dbPath);
		expect(db.getVariable("p1", "MIGRATE_ME")).toBe("plain-to-migrate");

		const verify = new Database(dbPath, { readonly: true });
		const row = verify
			.query("SELECT value FROM variables WHERE project_id = ? AND key = ?")
			.get("p1", "MIGRATE_ME") as { value: string };
		verify.close();
		expect(row.value.startsWith("enc:v2:")).toBe(true);
		expect(row.value).not.toContain("plain-to-migrate");
	});

	it("encrypts oauth access and refresh tokens at rest", () => {
		db.setOAuthToken("p1", "svc", {
			access_token: SECRET,
			refresh_token: `${SECRET}-refresh`,
		});
		const token = db.getOAuthToken("p1", "svc");
		expect(token?.access_token).toBe(SECRET);
		expect(token?.refresh_token).toBe(`${SECRET}-refresh`);

		db.close();
		const bytes = readFileSync(dbPath);
		expect(bytes.includes(Buffer.from(SECRET))).toBe(false);
		db = new CapaDatabase(dbPath);
	});

	it("does not persist git integration tokens in sqlite", () => {
		db.setGitIntegration("github", {
			access_token: SECRET,
			refresh_token: `${SECRET}-refresh`,
			token_type: "Bearer",
		});
		const row = db.getGitIntegration("github");
		expect(row?.access_token).toBe(SECRET);
		expect(row?.refresh_token).toBeNull();

		db.close();
		expect(readFileSync(dbPath).includes(Buffer.from(SECRET))).toBe(false);
		const raw = new Database(dbPath, { readonly: true });
		const stored = raw
			.query("SELECT access_token, refresh_token FROM git_integrations WHERE platform = ?")
			.get("github") as { access_token: string; refresh_token: string | null };
		raw.close();
		expect(stored.access_token).toBe("");
		expect(stored.refresh_token).toBeNull();
		db = new CapaDatabase(dbPath);
		expect(db.getGitIntegration("github")?.access_token).toBe(SECRET);
	});
});
