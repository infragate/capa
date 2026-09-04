import type { InstalledSubAgent } from "../db/sub-agents";
import type { SubAgent } from "../types/capabilities";
import { getProvider } from "./providers";

export interface SubAgentProviderTargets {
	targeted: string[];
	supported: string[];
	unsupported: string[];
}

/** Resolve provider ownership recorded before path-scoped installations existed. */
export function resolvePreviousSubAgentProviders(opts: {
	installedAgent: InstalledSubAgent;
	installPath: string;
	activeProviders: string[];
	previousProjectProviders: string[];
	isWrapInstall: boolean;
}): string[] {
	const scoped = opts.installedAgent.installations.find(
		(installation) => installation.install_path === opts.installPath,
	);
	if (scoped) return scoped.provider_ids;
	if (!opts.installedAgent.legacy_unscoped) return [];

	// Legacy wrap files were materialized for the wrap provider. A real checkout
	// used the project's provider set from before this install rewrote it.
	if (opts.isWrapInstall) return opts.activeProviders;
	return opts.previousProjectProviders.length > 0
		? opts.previousProjectProviders
		: opts.activeProviders;
}

/** Resolve a sub-agent allow-list against the providers active for this install. */
export function resolveSubAgentProviders(
	subAgent: SubAgent,
	activeProviders: string[],
): SubAgentProviderTargets {
	const allowList = subAgent.providers;
	const targeted =
		!allowList || allowList.length === 0
			? [...activeProviders]
			: activeProviders.filter((providerId) => allowList.includes(providerId));
	const supported: string[] = [];
	const unsupported: string[] = [];

	for (const providerId of targeted) {
		const provider = getProvider(providerId);
		if (
			provider?.subagents ||
			(provider?.instructions &&
				provider.foldSubAgentsIntoInstructions === true)
		) {
			supported.push(providerId);
		} else {
			unsupported.push(providerId);
		}
	}

	return { targeted, supported, unsupported };
}

export function getSubAgentProviderWarnings(
	subAgent: SubAgent,
	targets: SubAgentProviderTargets,
): string[] {
	const warnings = targets.unsupported.map(
		(providerId) =>
			`Sub-agent "${subAgent.id}": provider "${providerId}" cannot generate a sub-agent adapter (skipping)`,
	);
	if (
		subAgent.providers &&
		subAgent.providers.length > 0 &&
		targets.targeted.length === 0
	) {
		warnings.push(
			`Sub-agent "${subAgent.id}" targets no active providers (skipping)`,
		);
	}
	return warnings;
}
