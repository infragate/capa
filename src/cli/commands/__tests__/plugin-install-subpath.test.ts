import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolvePluginManifestRoot } from "../plugin-install";

describe("resolvePluginManifestRoot", () => {
	it("throws before copy when subpath is ../other", () => {
		const snapshotDir = mkdtempSync(join(tmpdir(), "capa-plugin-snap-"));
		expect(() => resolvePluginManifestRoot(snapshotDir, "../other")).toThrow(
			/\.\./,
		);
	});

	it("resolves a nested subpath inside the snapshot", () => {
		const snapshotDir = mkdtempSync(join(tmpdir(), "capa-plugin-snap-"));
		const resolved = resolvePluginManifestRoot(snapshotDir, "plugins/foo");
		expect(resolved.startsWith(snapshotDir)).toBe(true);
		expect(resolved.endsWith(join("plugins", "foo")) || resolved.endsWith("plugins/foo")).toBe(true);
	});
});
