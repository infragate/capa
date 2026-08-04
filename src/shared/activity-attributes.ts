/**
 * Provider-configured extraction of activity envelope attributes
 * (model, versions, etc.) for storage and future telemetry fan-out.
 */

import type {
	ActivityAttributeField,
	ActivityAttributesIntegration,
} from "../types/providers";
import { asRecord, stringField } from "./agent-activity-fields";
import { getProvider } from "./providers";

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
		const working: ActivityAttributes = { ...attributes };
		const dropOrder = Object.keys(working);
		while (dropOrder.length > 0) {
			const json = JSON.stringify(working);
			if (json.length <= ACTIVITY_ATTRIBUTES_MAX_JSON_CHARS) return json;
			const key = dropOrder.pop();
			if (key) delete working[key];
		}
		return null;
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
		if (
			typeof raw === "string" ||
			typeof raw === "number" ||
			typeof raw === "boolean"
		) {
			return raw;
		}
		if (Array.isArray(raw)) {
			return raw;
		}
		if (typeof raw === "object") {
			return raw;
		}
	}
	return undefined;
}
