import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CapaDatabase } from "../../db/database";
import type { RegistryManager } from "../../shared/registries/manager";
import { parseCapabilitiesFile } from "../../shared/capabilities";
import { resolveProvidersForServer } from "../resolve-effective-capabilities";
import {
	type CapabilitiesRouteDeps,
	handleCapabilitiesMutation,
} from "../capabilities-routes";
import { redactProjectPath } from "../capabilities-route-helpers";

const PROJECT = "proj";
const PATH = `/api/projects/${PROJECT}/capabilities/providers`;

describe("PUT /capabilities/providers", () => {
	let dir: string;
	let file: string;
	let deps: CapabilitiesRouteDeps;
	let stored: string[];

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "capa-providers-route-"));
		file = join(dir, "capabilities.yaml");
		await Bun.write(file, "# keep me\nproviders:\n  - cursor\nskills: []\n");
		stored = ["cursor"];
		deps = {
			db: {
				getProject: () => ({ path: dir }),
				getProjectProviders: () => stored,
				setProjectProviders: (_id: string, list: string[]) => {
					stored = list;
				},
			} as unknown as CapaDatabase,
			registryManager: {} as RegistryManager,
			configure: async () => ({}),
		};
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	const put = (body: unknown) =>
		handleCapabilitiesMutation(
			deps,
			PROJECT,
			PATH,
			"PUT",
			new Request(`http://localhost${PATH}`, {
				method: "PUT",
				body: JSON.stringify(body),
			}),
		);

	it("replaces the list, canonicalizes and dedupes ids, keeps comments", async () => {
		const res = await put({ providers: ["cursor", "Claude-Code", "claude-code"] });
		expect(res?.status).toBe(200);
		const caps = await parseCapabilitiesFile(file, "yaml");
		expect(caps.providers).toEqual(["cursor", "claude-code"]);
		expect(await Bun.file(file).text()).toContain("# keep me");
	});

	it("rejects unknown provider ids without writing", async () => {
		const res = await put({ providers: ["cursor", "not-a-provider"] });
		expect(res?.status).toBe(400);
		expect((await res!.json()).error).toContain("not-a-provider");
		const caps = await parseCapabilitiesFile(file, "yaml");
		expect(caps.providers).toEqual(["cursor"]);
	});

	it("rejects a body without a string array", async () => {
		expect((await put({ providers: "cursor" }))?.status).toBe(400);
		expect((await put({ providers: [1] }))?.status).toBe(400);
		expect((await put(null))?.status).toBe(400);
	});

	it("rejects inherited object keys as provider ids without writing", async () => {
		const before = await Bun.file(file).text();
		for (const id of ["constructor", "__proto__"]) {
			const res = await put({ providers: [id] });
			expect(res?.status).toBe(400);
		}
		expect(await Bun.file(file).text()).toBe(before);
	});

	it("returns a JSON 400 when the existing file is malformed", async () => {
		await Bun.write(file, "providers: [cursor\n");
		const res = await put({ providers: ["cursor"] });
		expect(res?.status).toBe(400);
		const { error } = await res!.json();
		expect(typeof error).toBe("string");
		expect(error).not.toContain(dir);
		expect(error).not.toContain(dir.replaceAll("\\", "/"));
	});

	it("returns a JSON 400 when both capabilities.yaml and .json exist", async () => {
		await Bun.write(join(dir, "capabilities.json"), "{}");
		const res = await put({ providers: ["cursor"] });
		expect(res?.status).toBe(400);
		expect((await res!.json()).error).toContain("Both capabilities.yaml and capabilities.json");
	});

	it("PUT /agents rejects a null or non-object body with a 400", async () => {
		const agentsPath = `/api/projects/${PROJECT}/capabilities/agents`;
		for (const body of ["null", "1", '"x"', "[]"]) {
			const res = await handleCapabilitiesMutation(
				deps,
				PROJECT,
				agentsPath,
				"PUT",
				new Request(`http://localhost${agentsPath}`, { method: "PUT", body }),
			);
			expect(res?.status).toBe(400);
			expect((await res!.json()).error).toContain('"agents" field');
		}
	});

	it("never echoes the project's absolute path in an error", () => {
		const native = join(dir, "capabilities.yaml");
		const msg = `ENOENT: no such file or directory, open '${native}'`;
		expect(redactProjectPath(msg, dir)).toBe(
			"ENOENT: no such file or directory, open 'capabilities.yaml'",
		);
		const slashed = msg.replaceAll("\\", "/");
		expect(redactProjectPath(slashed, dir)).not.toContain(dir.replaceAll("\\", "/"));
	});

	it("removes the key when the list is empty", async () => {
		const res = await put({ providers: [] });
		expect(res?.status).toBe(200);
		const caps = await parseCapabilitiesFile(file, "yaml");
		expect(caps.providers).toBeUndefined();
		expect(stored).toEqual([]);
		expect(resolveProvidersForServer(caps, deps.db, PROJECT)).toBeNull();
	});
});
