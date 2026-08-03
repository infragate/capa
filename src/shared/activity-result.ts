/**
 * Provider-configured extraction of tool/shell result payloads from hook stdin.
 */

import { getProvider } from "./providers";
import { asRecord } from "./agent-activity-fields";

/**
 * Read the result/output field using the provider's `hooks.activityResultFields`
 * map. Returns undefined when unset or no field is present.
 */
export function extractActivityResult(
	providerId: string | null | undefined,
	raw: unknown,
): unknown {
	const obj = asRecord(raw);
	if (!obj) return undefined;

	const fields = resolveResultFields(providerId);
	if (!fields || fields.length === 0) return undefined;

	for (const name of fields) {
		if (!(name in obj)) continue;
		const value = obj[name];
		if (value === undefined || value === null) continue;
		return value;
	}
	return undefined;
}

export function resolveResultFields(
	providerId: string | null | undefined,
): readonly string[] | null {
	if (!providerId) return null;
	const provider = getProvider(providerId);
	return provider?.hooks?.activityResultFields ?? null;
}
