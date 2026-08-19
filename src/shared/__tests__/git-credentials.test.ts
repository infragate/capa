import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	approveGitHttpCredential,
	fillGitHttpCredential,
	gitHostForPlatform,
	hasGitHttpCredential,
	rejectGitHttpCredential,
	resetGitCredentialsForTests,
} from "../git-credentials";

describe("git-credentials", () => {
	let home: string;
	let prevHome: string | undefined;
	let prevProfile: string | undefined;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "capa-git-cred-"));
		prevHome = process.env.HOME;
		prevProfile = process.env.USERPROFILE;
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		resetGitCredentialsForTests();
	});

	afterEach(() => {
		resetGitCredentialsForTests();
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		if (prevProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = prevProfile;
		rmSync(home, { recursive: true, force: true });
	});

	it("maps platforms to hosts", () => {
		expect(gitHostForPlatform("github", null)).toBe("github.com");
		expect(gitHostForPlatform("gitlab")).toBe("gitlab.com");
		expect(gitHostForPlatform("github-enterprise", "git.corp")).toBe("git.corp");
	});

	it("round-trips through the in-memory helper used in tests", () => {
		expect(hasGitHttpCredential("github.com")).toBe(false);
		approveGitHttpCredential("github.com", "gho_test_token");
		expect(fillGitHttpCredential("github.com")).toBe("gho_test_token");
		expect(hasGitHttpCredential("github.com")).toBe(true);
		rejectGitHttpCredential("github.com");
		expect(fillGitHttpCredential("github.com")).toBeNull();
	});

	it("maps GitHub raw/api hosts onto github.com credentials", () => {
		approveGitHttpCredential("github.com", "gho_test_token");
		expect(fillGitHttpCredential("raw.githubusercontent.com")).toBe(
			"gho_test_token",
		);
		expect(fillGitHttpCredential("api.github.com")).toBe("gho_test_token");
	});
});
