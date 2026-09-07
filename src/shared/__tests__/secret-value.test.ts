import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	hasUnresolvedSecretSources,
	isSecretValueObject,
	mcpServerIdsPendingCredentials,
	resolveSecretValue,
	resolveSecretValueRecord,
	SecretValueResolveError,
	secretValueSchema,
} from "../secret-value";

describe("secretValueSchema", () => {
	it("accepts literals and single-key source objects", () => {
		expect(secretValueSchema.parse("literal")).toBe("literal");
		expect(secretValueSchema.parse({ fromEnv: "FOO" })).toEqual({
			fromEnv: "FOO",
		});
		expect(secretValueSchema.parse({ fromCommand: "op read x" })).toEqual({
			fromCommand: "op read x",
		});
		expect(secretValueSchema.parse({ fromFile: "./secret" })).toEqual({
			fromFile: "./secret",
		});
	});

	it("rejects multi-key or empty objects", () => {
		expect(() =>
			secretValueSchema.parse({ fromEnv: "A", fromFile: "B" }),
		).toThrow();
		expect(() => secretValueSchema.parse({})).toThrow();
	});
});

describe("resolveSecretValue", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "capa-secret-value-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns string literals unchanged", async () => {
		expect(await resolveSecretValue("${Var}", { projectPath: dir })).toBe(
			"${Var}",
		);
	});

	it("resolves fromEnv", async () => {
		const value = await resolveSecretValue(
			{ fromEnv: "CAPA_TEST_SECRET_ENV" },
			{
				projectPath: dir,
				env: { CAPA_TEST_SECRET_ENV: "from-the-env" },
			},
		);
		expect(value).toBe("from-the-env");
	});

	it("fails when fromEnv is missing", async () => {
		await expect(
			resolveSecretValue(
				{ fromEnv: "MISSING_CAPA_ENV" },
				{ projectPath: dir, env: {} },
			),
		).rejects.toBeInstanceOf(SecretValueResolveError);
	});

	it("resolves fromFile relative to project path", async () => {
		writeFileSync(join(dir, "token.txt"), "file-secret\n");
		const value = await resolveSecretValue(
			{ fromFile: "token.txt" },
			{ projectPath: dir },
		);
		expect(value).toBe("file-secret");
	});

	it("resolves fromCommand via override", async () => {
		const value = await resolveSecretValue(
			{ fromCommand: "op read op://x" },
			{
				projectPath: dir,
				runCommand: async () => "cmd-secret\n",
			},
		);
		expect(value).toBe("cmd-secret");
	});

	it("resolves a full record", async () => {
		const record = await resolveSecretValueRecord(
			{
				A: "literal",
				B: { fromEnv: "X" },
			},
			{ projectPath: dir, env: { X: "env-x" } },
		);
		expect(record).toEqual({ A: "literal", B: "env-x" });
	});
});

describe("isSecretValueObject / hasUnresolvedSecretSources", () => {
	it("detects source objects", () => {
		expect(isSecretValueObject({ fromEnv: "A" })).toBe(true);
		expect(isSecretValueObject("x")).toBe(false);
		expect(
			hasUnresolvedSecretSources({
				env: { K: { fromCommand: "op read x" } },
			}),
		).toBe(true);
		expect(hasUnresolvedSecretSources({ env: { K: "done" } })).toBe(false);
	});
});

describe("mcpServerIdsPendingCredentials", () => {
	it("includes servers whose headers still reference a missing ${var}", () => {
		expect(
			mcpServerIdsPendingCredentials(
				[
					{
						id: "sharecube",
						def: {
							url: "https://example.test/mcp",
							headers: { Authorization: "Bearer ${ShareCubeApiKey}" },
						},
					},
					{
						id: "aws-knowledge",
						def: { url: "https://knowledge-mcp.global.api.aws" },
					},
				],
				["ShareCubeApiKey"],
			),
		).toEqual(["sharecube"]);
	});

	it("does not include a ${var} server once the variable is present", () => {
		expect(
			mcpServerIdsPendingCredentials(
				[
					{
						id: "sharecube",
						def: {
							url: "https://example.test/mcp",
							headers: { Authorization: "Bearer ${ShareCubeApiKey}" },
						},
					},
				],
				[],
			),
		).toEqual([]);
	});

	it("includes servers with unresolved secret-source objects", () => {
		expect(
			mcpServerIdsPendingCredentials(
				[
					{
						id: "vaulted",
						def: {
							url: "https://example.test/mcp",
							headers: { Authorization: { fromEnv: "TOKEN" } },
						},
					},
				],
				[],
			),
		).toEqual(["vaulted"]);
	});
});
