import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import type { AuthenticatedFetch } from "../../shared/authenticated-fetch";
import { getSnapshotDir } from "../../shared/cache";
import { gitRepoKey } from "../../shared/git-url";
import { serverRepoSnapshot } from "../resolve-effective-capabilities";
import {
	fetchUninstalledSkillContent,
	previewSnapshotSkill,
} from "../skill-content";

const SKILL = "---\nname: s\ndescription: d\n---\n\nBody.\n";

// Hands out a token for every URL, so a test fails if one ever gets used.
const leakyAuth = {
	hasAuth: () => true,
	getTokenForUrl: () => "gho_SHOULD_NOT_BE_SENT",
	fetch: () => Promise.reject(new Error("no network in tests")),
} as unknown as AuthenticatedFetch;

let dir: string;
const prevCacheDir = process.env.CAPA_CACHE_DIR;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "capa-skill-content-git-"));
	process.env.CAPA_CACHE_DIR = join(dir, "cache");
});

afterEach(() => {
	if (prevCacheDir === undefined) delete process.env.CAPA_CACHE_DIR;
	else process.env.CAPA_CACHE_DIR = prevCacheDir;
	rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function bareRepoWithSkill(): string {
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" });
	const work = join(dir, "work");
	mkdirSync(work);
	git(work, "init", "-q", "-b", "main");
	git(work, "config", "user.email", "capa-test@example.com");
	git(work, "config", "user.name", "capa-test");
	writeFileSync(join(work, "SKILL.md"), SKILL);
	git(work, "add", "-A");
	git(work, "commit", "-q", "-m", "init");
	const bare = join(dir, "skill.git");
	git(dir, "clone", "-q", "--bare", work, bare);
	return pathToFileURL(bare).href;
}

function cacheIsEmpty(): boolean {
	const cache = join(dir, "cache");
	return !existsSync(cache) || readdirSync(cache).length === 0;
}

describe("server preview of an uninstalled git skill", () => {
	it("does not clone a file:// URL from the project file", async () => {
		const url = bareRepoWithSkill();
		const result = await fetchUninstalledSkillContent(
			{ id: "s", type: "git", def: { url } },
			leakyAuth,
		);
		expect(result).toBeNull();
		expect(cacheIsEmpty()).toBe(true);
	});

	it("refuses loopback, private, ssh and plain http URLs before any git call", async () => {
		for (const url of [
			"http://localhost:8080/a/s.git",
			"https://127.0.0.1/a/s.git",
			"https://10.0.0.5/a/s.git",
			"ssh://git@h.test/a/s.git",
			"https://user:pw@h.test/a/s.git",
		]) {
			const result = await fetchUninstalledSkillContent(
				{ id: "s", type: "git", def: { url } },
				leakyAuth,
			);
			expect(result).toBeNull();
		}
		expect(cacheIsEmpty()).toBe(true);
	});
});

describe("serverRepoSnapshot for git plugins", () => {
	it("refuses to clone a non-public URL", async () => {
		const url = bareRepoWithSkill();
		await expect(
			serverRepoSnapshot("git", gitRepoKey(url), leakyAuth, { repoUrl: url }),
		).rejects.toThrow(/Only https URLs are allowed/);
		expect(cacheIsEmpty()).toBe(true);
	});

	it("uses a snapshot capa install already pinned, offline, whatever the URL", async () => {
		const url = "ssh://git@h.test/a/plugin.git";
		const sha = "a".repeat(40);
		const snapshotDir = getSnapshotDir("git", gitRepoKey(url), sha);
		mkdirSync(snapshotDir, { recursive: true });
		const result = await serverRepoSnapshot("git", gitRepoKey(url), leakyAuth, {
			repoUrl: url,
			pinnedSha: sha,
		});
		expect(result.snapshotDir).toBe(snapshotDir);
	});
});

describe("previewSnapshotSkill", () => {
	function snapshot(): string {
		const root = join(dir, "snap");
		mkdirSync(join(root, "skill"), { recursive: true });
		return root;
	}

	function outsideSkillDir(): string {
		const outside = join(dir, "outside");
		mkdirSync(outside);
		writeFileSync(join(outside, "SKILL.md"), "---\nname: secret\n---\n");
		return outside;
	}

	it("reads a regular SKILL.md", () => {
		const root = snapshot();
		writeFileSync(join(root, "skill", "SKILL.md"), SKILL);
		expect(previewSnapshotSkill(root, join(root, "skill", "SKILL.md"))?.content).toBe(SKILL);
	});

	it("refuses a skill directory linked outside the snapshot", () => {
		const root = snapshot();
		const outside = outsideSkillDir();
		// Junctions need no privileges on Windows; elsewhere the type is ignored.
		symlinkSync(outside, join(root, "linked"), "junction");
		expect(previewSnapshotSkill(root, join(root, "linked", "SKILL.md"))).toBeNull();
	});

	it("refuses a SKILL.md that is a symlink", () => {
		const root = snapshot();
		const outside = outsideSkillDir();
		const link = join(root, "skill", "SKILL.md");
		try {
			symlinkSync(join(outside, "SKILL.md"), link, "file");
		} catch {
			// File symlinks need Developer Mode or admin on Windows.
			console.warn("skipping: cannot create file symlinks here");
			return;
		}
		expect(previewSnapshotSkill(root, link)).toBeNull();
	});
});
