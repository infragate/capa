import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CapaDatabase } from "../../db/database";
import type { RegistryManager } from "../../shared/registries/manager";
import { parseCapabilitiesFile } from "../../shared/capabilities";
import {
	type CapabilitiesRouteDeps,
	handleCapabilitiesMutation,
} from "../capabilities-routes";

const PROJECT = "proj";
const PATH = `/api/projects/${PROJECT}/capabilities/providers`;

describe("PUT /capabilities/providers", () => {
	let dir: string;
	let file: string;
	let deps: CapabilitiesRouteDeps;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "capa-providers-route-"));
		file = join(dir, "capabilities.yaml");
		await Bun.write(file, "# keep me\nproviders:\n  - cursor\nskills: []\n");
		deps = {
			db: { getProject: () => ({ path: dir }) } as unknown as CapaDatabase,
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
	});

	it("removes the key when the list is empty", async () => {
		const res = await put({ providers: [] });
		expect(res?.status).toBe(200);
		const caps = await parseCapabilitiesFile(file, "yaml");
		expect(caps.providers).toBeUndefined();
	});
});
