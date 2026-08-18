import { describe, expect, it } from "bun:test";
import type { Capabilities } from "../../types/capabilities";
import { buildVariablesResponse } from "../capabilities-routes";

const SECRET = "capa-f6-plain-secret-TOKEN-9zQ2";

const caps: Capabilities = {
	skills: [],
	tools: [],
	servers: [
		{
			id: "weather",
			type: "mcp",
			def: {
				cmd: "npx",
				env: { API_KEY: "${API_KEY}" },
			},
		},
	],
};

describe("buildVariablesResponse", () => {
	it("does not include raw secret strings in the payload", () => {
		const body = buildVariablesResponse(caps, { API_KEY: SECRET });
		expect(JSON.stringify(body)).not.toContain(SECRET);
		expect(body).not.toHaveProperty("values");
	});

	it("returns a secrets catalog with isSet and a last-4 hint", () => {
		const body = buildVariablesResponse(caps, { API_KEY: SECRET });
		expect(body.required).toContain("API_KEY");
		expect(body.catalog).toContain("API_KEY");
		expect(body.secrets).toEqual([
			{ name: "API_KEY", isSet: true, hint: "9zQ2" },
		]);
	});

	it("marks unset required variables as isSet false with an empty hint", () => {
		const body = buildVariablesResponse(caps, {});
		expect(body.required).toContain("API_KEY");
		const entry = body.secrets.find((s) => s.name === "API_KEY");
		expect(entry).toEqual({ name: "API_KEY", isSet: false, hint: "" });
	});

	it("never uses the full value as a hint for short secrets", () => {
		const body = buildVariablesResponse(caps, { API_KEY: "ab" });
		expect(JSON.stringify(body)).not.toContain('"ab"');
		const entry = body.secrets.find((s) => s.name === "API_KEY");
		expect(entry?.isSet).toBe(true);
		expect(entry?.hint).toBe("");
	});
});
