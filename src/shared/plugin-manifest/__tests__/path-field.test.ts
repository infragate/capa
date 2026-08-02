import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
	collectFiles,
	normalizePathField,
	resolveComponentPaths,
} from "../path-field";

describe("plugin-manifest path-field", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "capa-path-field-"));
		mkdirSync(join(root, "commands"), { recursive: true });
		writeFileSync(join(root, "commands", "ship.md"), "Ship\n");
		mkdirSync(join(root, "outside"), { recursive: true });
		writeFileSync(join(root, "outside", "secret.md"), "secret\n");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("normalizePathField strips ./ and drops empty segments", () => {
		expect(normalizePathField("./commands/")).toEqual(["commands"]);
		expect(normalizePathField(["./a", "b/"])).toEqual(["a", "b"]);
	});

	it("normalizePathField rejects absolute and parent-segment paths", () => {
		expect(normalizePathField("../outside")).toEqual([]);
		expect(normalizePathField("/etc/passwd")).toEqual([]);
		expect(normalizePathField("C:\\Windows")).toEqual([]);
		expect(normalizePathField(["commands", "../outside", "/tmp"])).toEqual([
			"commands",
		]);
	});

	it("resolveComponentPaths uses defaults when the field is unset", () => {
		expect(resolveComponentPaths({}, "commands", "commands")).toEqual([
			"commands",
		]);
	});

	it("resolveComponentPaths keeps an empty list when all manifest paths are unsafe", () => {
		expect(
			resolveComponentPaths({ commands: ["../x", "/etc"] }, "commands", "commands"),
		).toEqual([]);
	});

	it("collectFiles returns in-root paths only", () => {
		expect(collectFiles(root, "commands", { extensions: [".md"] })).toEqual([
			"commands/ship.md",
		]);
	});

	it("collectFiles rejects traversal and absolute paths", () => {
		expect(collectFiles(root, "../outside", { extensions: [".md"] })).toEqual(
			[],
		);
		expect(collectFiles(root, "/etc", { extensions: [".md"] })).toEqual([]);
		expect(
			collectFiles(root, "commands/../../outside", { extensions: [".md"] }),
		).toEqual([]);
	});
});
