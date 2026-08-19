import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	isSecretRef,
	resolveSecretRecord,
	resolveSecretValue,
} from "../secret-ref";

describe("secret-ref", () => {
	it("detects fromEnv / fromCommand / fromFile objects", () => {
		expect(isSecretRef({ fromEnv: "API_KEY" })).toBe(true);
		expect(isSecretRef({ fromCommand: "op read op://x" })).toBe(true);
		expect(isSecretRef({ fromFile: "/tmp/token" })).toBe(true);
		expect(isSecretRef("literal")).toBe(false);
		expect(isSecretRef({ fromEnv: "A", fromFile: "B" })).toBe(false);
		expect(isSecretRef({ fromEnv: "" })).toBe(false);
	});

	it("resolves fromEnv", () => {
		const prev = process.env.CAPA_TEST_FROM_ENV;
		process.env.CAPA_TEST_FROM_ENV = "env-secret-value";
		try {
			expect(resolveSecretValue({ fromEnv: "CAPA_TEST_FROM_ENV" })).toBe(
				"env-secret-value",
			);
		} finally {
			if (prev === undefined) delete process.env.CAPA_TEST_FROM_ENV;
			else process.env.CAPA_TEST_FROM_ENV = prev;
		}
	});

	it("resolves fromFile", () => {
		const dir = mkdtempSync(join(tmpdir(), "capa-secret-file-"));
		const path = join(dir, "token");
		writeFileSync(path, "file-secret\n");
		try {
			expect(resolveSecretValue({ fromFile: path })).toBe("file-secret");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("resolves fromCommand without a shell", () => {
		const exe = process.execPath;
		const result = resolveSecretValue({
			fromCommand: `${JSON.stringify(exe)} -e ${JSON.stringify("process.stdout.write('cmd-secret')")}`,
		});
		expect(result).toBe("cmd-secret");
	});

	it("refuses fromCommand that starts with a shell", () => {
		expect(() =>
			resolveSecretValue({ fromCommand: "sh -c 'echo pwned'" }),
		).toThrow(/refuses to run a shell/);
	});

	it("resolves a mixed env/header record", () => {
		process.env.CAPA_TEST_FROM_ENV = "via-env";
		const resolved = resolveSecretRecord({
			LITERAL: "plain",
			FROM_ENV: { fromEnv: "CAPA_TEST_FROM_ENV" },
		});
		expect(resolved).toEqual({ LITERAL: "plain", FROM_ENV: "via-env" });
		delete process.env.CAPA_TEST_FROM_ENV;
	});
});
