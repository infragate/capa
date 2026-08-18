import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
} from "fs";
import { join, win32 } from "path";
import { tmpdir } from "os";
import {
	assertCapaOwnedInstallPath,
	assertInsideProjectRoot,
	validateProviderInstallRoots,
} from "../install-path-guard";

describe("install-path-guard", () => {
	let projectDir: string;

	beforeEach(() => {
		projectDir = mkdtempSync(join(tmpdir(), "capa-install-guard-"));
		mkdirSync(join(projectDir, ".cursor"), { recursive: true });
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
	});

	it("allows writes under real provider directories", () => {
		mkdirSync(join(projectDir, ".cursor", "skills"), { recursive: true });
		expect(() =>
			assertCapaOwnedInstallPath(
				projectDir,
				join(projectDir, ".cursor", "skills", "demo"),
			),
		).not.toThrow();
	});

	it("refuses writes through a symlink in the parent chain", () => {
		mkdirSync(join(projectDir, "skills"), { recursive: true });
		symlinkSync(
			join(projectDir, "skills"),
			join(projectDir, ".cursor", "skills"),
		);
		expect(() =>
			assertCapaOwnedInstallPath(
				projectDir,
				join(projectDir, ".cursor", "skills", "demo"),
			),
		).toThrow(/symlink/i);
	});

	it("refuses when provider install root is a symlink", () => {
		mkdirSync(join(projectDir, "skills"), { recursive: true });
		symlinkSync(
			join(projectDir, "skills"),
			join(projectDir, ".cursor", "skills"),
		);
		expect(() =>
			validateProviderInstallRoots(projectDir, ["cursor"]),
		).toThrow(/symlink/i);
	});

	it("allows paths that do not exist yet when parents are safe", () => {
		expect(() =>
			assertCapaOwnedInstallPath(
				projectDir,
				join(projectDir, ".cursor", "skills", "new-skill"),
			),
		).not.toThrow();
		expect(existsSync(join(projectDir, ".cursor", "skills"))).toBe(false);
	});

	it("rejects cross-drive destinations on Windows paths", () => {
		const ops = {
			resolve: win32.resolve,
			relative: win32.relative,
			isAbsolute: win32.isAbsolute,
			parse: win32.parse,
			sep: win32.sep,
		};
		expect(() =>
			assertInsideProjectRoot("C:\\capa\\project", "D:\\outside\\file.md", ops),
		).toThrow(/outside the project root/i);
	});
});
