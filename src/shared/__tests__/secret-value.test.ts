import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CapaDatabase } from "../../db/database";
import type { MCPServer } from "../../types/capabilities";
import {
	hasUnresolvedSecretSources,
	isSecretValueObject,
	mcpServerIdsPendingCredentials,
	resolveSecretValue,
	resolveSecretValueRecord,
	SecretValueResolveError,
	secretValueSchema,
	type SecretValue,
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
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "capa-pending-creds-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	const ctx = (vars: Record<string, string> = {}) => ({
		projectId: "p1",
		projectPath: dir,
		db: {
			getVariable: (_projectId: string, key: string) => vars[key] ?? null,
		} as unknown as CapaDatabase,
	});

	const server = (id: string, headers: Record<string, SecretValue>) => ({
		id,
		def: { url: "https://example.test/mcp", headers },
	});

	it("includes servers whose headers still reference a missing ${var}", async () => {
		expect(
			await mcpServerIdsPendingCredentials(
				[
					server("sharecube", {
						Authorization: "Bearer ${ShareCubeApiKey}",
					}),
					{ id: "aws-knowledge", def: { url: "https://knowledge.test" } },
				],
				ctx(),
			),
		).toEqual(["sharecube"]);
	});

	it("does not include a ${var} server once the variable is present", async () => {
		expect(
			await mcpServerIdsPendingCredentials(
				[server("sharecube", { Authorization: "Bearer ${ShareCubeApiKey}" })],
				ctx({ ShareCubeApiKey: "sk-live" }),
			),
		).toEqual([]);
	});

	it("includes a secret source that fails to resolve", async () => {
		expect(
			await mcpServerIdsPendingCredentials(
				[server("vaulted", { Authorization: { fromEnv: "CAPA_TEST_UNSET" } })],
				{ ...ctx(), env: {} },
			),
		).toEqual(["vaulted"]);
	});

	it("does not include a secret source that resolves", async () => {
		expect(
			await mcpServerIdsPendingCredentials(
				[server("vaulted", { Authorization: { fromEnv: "CAPA_TEST_TOKEN" } })],
				{ ...ctx(), env: { CAPA_TEST_TOKEN: "tok" } },
			),
		).toEqual([]);
	});

	it("includes a plugin-contributed server with an unset ${var}", async () => {
		const pluginServer: MCPServer = {
			...server("plugin-server", { Authorization: "Bearer ${PluginToken}" }),
			type: "mcp",
			sourcePlugin: {
				id: "some-plugin@abc123",
				name: "some-plugin",
				provider: "claude",
			},
		};
		expect(
			await mcpServerIdsPendingCredentials([pluginServer], ctx()),
		).toEqual(["plugin-server"]);
	});
});
