import { describe, expect, it } from "bun:test";
import {
	ACTIVITY_ATTRIBUTES_MAX_JSON_CHARS,
	extractActivityAttributes,
	serializeActivityAttributes,
} from "../activity-attributes";

describe("extractActivityAttributes", () => {
	it("extracts Cursor model envelope fields from provider config", () => {
		const out = extractActivityAttributes("cursor", {
			model: "claude-opus-4",
			model_id: "claude-opus-4-7",
			model_params: [{ id: "thinking", value: "true" }],
			cursor_version: "1.7.2",
			user_email: "dev@example.com",
			duration: 1234,
			sandbox: false,
			tool_name: "Read",
		});
		expect(out.model).toBe("claude-opus-4");
		expect(out.attributes.model).toBe("claude-opus-4");
		expect(out.attributes.model_id).toBe("claude-opus-4-7");
		expect(out.attributes.provider_version).toBe("1.7.2");
		expect(out.attributes.user_email).toBe("dev@example.com");
		expect(out.attributes.duration_ms).toBe(1234);
		expect(out.attributes.sandbox).toBe(false);
		expect(out.attributes.model_params).toEqual([
			{ id: "thinking", value: "true" },
		]);
		// Not in the allowlist map as a capa key from tool_name
		expect(out.attributes.tool_name).toBeUndefined();
	});

	it("extracts Claude model + permission_mode", () => {
		const out = extractActivityAttributes("claude-code", {
			model: "claude-sonnet-4",
			permission_mode: "default",
			cwd: "/tmp/proj",
			hook_event_name: "PostToolUse",
		});
		expect(out.model).toBe("claude-sonnet-4");
		expect(out.attributes.permission_mode).toBe("default");
		expect(out.attributes.cwd).toBe("/tmp/proj");
	});

	it("returns empty when provider has no activityAttributes", () => {
		const out = extractActivityAttributes("gemini-cli", {
			model: "gemini-2.5",
		});
		expect(out).toEqual({ attributes: {}, model: null });
	});
});

describe("serializeActivityAttributes", () => {
	it("returns null for empty bags", () => {
		expect(serializeActivityAttributes({})).toBeNull();
	});

	it("round-trips a small bag", () => {
		expect(serializeActivityAttributes({ model: "x", duration_ms: 1 })).toBe(
			JSON.stringify({ model: "x", duration_ms: 1 }),
		);
	});

	it("returns valid JSON or null when over the size cap", () => {
		const huge = "x".repeat(ACTIVITY_ATTRIBUTES_MAX_JSON_CHARS + 500);
		const serialized = serializeActivityAttributes({
			model: "small",
			dump: huge,
			keep: "yes",
		});
		if (serialized === null) return;
		expect(() => JSON.parse(serialized)).not.toThrow();
		expect(serialized.length).toBeLessThanOrEqual(
			ACTIVITY_ATTRIBUTES_MAX_JSON_CHARS,
		);
	});
});
