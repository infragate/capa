/**
 * Provider-configured extraction of activity envelope attributes
 * (model, versions, etc.) for storage and future telemetry fan-out.
 */

import type {
	ActivityAttributeField,
	ActivityAttributesIntegration,
} from "../types/providers";
import { getProvider } from "./providers";
import { asRecord, stringField } from "./agent-activity-fields";

/** Soft cap so attributes stay metadata-sized (not tool output dumps). */
export const ACTIVITY_ATTRIBUTES_MAX_JSON_CHARS = 16_000;

export type ActivityAttributes = Record<string, unknown>;

export interface ExtractedActivityAttributes {
	/** Full attribute bag (JSON-serializable). Empty object when nothing found. */
	attributes: ActivityAttributes;
	/** Convenience: attributes.model as string when present. */
	model: string | null;
}

/**
 * Resolve envelope attributes from hook stdin using the provider's
 * `hooks.activityAttributes` map. No provider-specific hardcoding.
 */
export function extractActivityAttributes(
	providerId: string | null | undefined,
	raw: unknown,
): ExtractedActivityAttributes {
	const empty: ExtractedActivityAttributes = { attributes: {}, model: null };
	const obj = asRecord(raw);
	if (!obj) return empty;

	const config = resolveAttributesConfig(providerId);
	if (!config) return empty;

	const attributes: ActivityAttributes = {};
	for (const field of config.attributes) {
		const value = readAttribute(obj, field);
		if (value === undefined) continue;
		attributes[field.key] = value;
	}

	const model =
		typeof attributes.model === "string" && attributes.model.trim()
			? attributes.model.trim()
			: null;

	return { attributes, model };
}

export function resolveAttributesConfig(
	providerId: string | null | undefined,
): ActivityAttributesIntegration | null {
	if (!providerId) return null;
	const provider = getProvider(providerId);
	return provider?.hooks?.activityAttributes ?? null;
}

export function serializeActivityAttributes(
	attributes: ActivityAttributes,
): string | null {
	if (!attributes || Object.keys(attributes).length === 0) return null;
	try {
		const json = JSON.stringify(attributes);
		if (json.length <= ACTIVITY_ATTRIBUTES_MAX_JSON_CHARS) return json;
		return `${json.slice(0, ACTIVITY_ATTRIBUTES_MAX_JSON_CHARS - 1)}…`;
	} catch {
		return null;
	}
}

function readAttribute(
	obj: Record<string, unknown>,
	field: ActivityAttributeField,
): unknown {
	const kind = field.kind ?? "string";
	for (const name of field.fields) {
		if (!(name in obj)) continue;
		const raw = obj[name];
		if (raw === undefined || raw === null) continue;

		if (kind === "string") {
			const s = stringField(obj, name)?.trim();
			if (s) return s;
			continue;
		}
		if (kind === "number") {
			if (typeof raw === "number" && Number.isFinite(raw)) return raw;
			if (typeof raw === "string" && raw.trim()) {
				const n = Number(raw);
				if (Number.isFinite(n)) return n;
			}
			continue;
		}
		if (kind === "boolean") {
			if (typeof raw === "boolean") return raw;
			continue;
		}
		// json — keep serializable values; skip functions/symbols
		if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
			return raw;
		}
		if (Array.isArray(raw) || (typeof raw === "object" && raw !== null)) {
			return raw;
		}
	}
	return undefined;
}
