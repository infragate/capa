/**
 * Provider-configured extraction of activity conversation / generation ids.
 */

import type { ActivityCorrelationIntegration } from "../types/providers";
import { asRecord, stringField } from "./agent-activity-fields";
import { getProvider } from "./providers";

export interface ActivityCorrelationIds {
	conversationId: string | null;
	generationId: string | null;
}

/**
 * Resolve correlation ids from hook stdin using the provider's
 * `hooks.activityCorrelation` field map. No provider-specific hardcoding —
 * missing config → null ids (UI falls back to heuristic run boundaries).
 */
export function extractActivityCorrelation(
	providerId: string | null | undefined,
	raw: unknown,
): ActivityCorrelationIds {
	const obj = asRecord(raw);
	if (!obj) return { conversationId: null, generationId: null };

	const corr = resolveCorrelationConfig(providerId);
	if (!corr) return { conversationId: null, generationId: null };

	return {
		conversationId: firstConfiguredField(obj, corr.conversationIdFields),
		generationId: firstConfiguredField(obj, corr.generationIdFields),
	};
}

export function resolveCorrelationConfig(
	providerId: string | null | undefined,
): ActivityCorrelationIntegration | null {
	if (!providerId) return null;
	const provider = getProvider(providerId);
	return provider?.hooks?.activityCorrelation ?? null;
}

function firstConfiguredField(
	obj: Record<string, unknown>,
	fields: readonly string[],
): string | null {
	for (const field of fields) {
		const value = stringField(obj, field)?.trim();
		if (value) return value;
	}
	return null;
}
