import { describe, expect, it } from "bun:test";
import type { SubAgent } from "../../types/capabilities";
import {
	resolvePreviousSubAgentProviders,
	resolveSubAgentProviders,
} from "../subagent-providers";

const subAgent = (providers?: string[]): SubAgent => ({
	id: "reviewer",
	providers,
	skills: [],
	tools: [],
});

describe("resolvePreviousSubAgentProviders", () => {
	it("uses the historical project providers for a legacy real checkout", () => {
		expect(
			resolvePreviousSubAgentProviders({
				installedAgent: {
					agent_id: "reviewer",
					legacy_unscoped: true,
					installations: [],
				},
				installPath: "/repo",
				activeProviders: ["codex"],
				previousProjectProviders: ["claude-code", "cursor"],
				isWrapInstall: false,
			}),
		).toEqual(["claude-code", "cursor"]);
	});

	it("prefers path-scoped ownership over project history", () => {
		expect(
			resolvePreviousSubAgentProviders({
				installedAgent: {
					agent_id: "reviewer",
					legacy_unscoped: false,
					installations: [
						{ install_path: "/repo", provider_ids: ["gemini-cli"] },
					],
				},
				installPath: "/repo",
				activeProviders: ["codex"],
				previousProjectProviders: ["claude-code", "cursor"],
				isWrapInstall: false,
			}),
		).toEqual(["gemini-cli"]);
	});
});

describe("resolveSubAgentProviders", () => {
	it("targets every active provider when the allow-list is omitted or empty", () => {
		const active = ["claude-code", "codex"];

		expect(resolveSubAgentProviders(subAgent(), active).supported).toEqual(active);
		expect(resolveSubAgentProviders(subAgent([]), active).supported).toEqual(active);
	});

	it("preserves active-provider order while applying the allow-list", () => {
		const result = resolveSubAgentProviders(
			subAgent(["gemini-cli", "claude-code"]),
			["claude-code", "codex", "cursor", "gemini-cli"],
		);

		expect(result.supported).toEqual(["claude-code", "gemini-cli"]);
		expect(result.unsupported).toEqual([]);
	});

	it("reports active providers without a sub-agent adapter", () => {
		const result = resolveSubAgentProviders(subAgent(["crush"]), ["crush"]);

		expect(result.targeted).toEqual(["crush"]);
		expect(result.supported).toEqual([]);
		expect(result.unsupported).toEqual(["crush"]);
	});
});
