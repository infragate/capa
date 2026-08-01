import * as yaml from "js-yaml";
import type { YAMLMap, YAMLSeq } from "yaml";
import { isMap, isSeq, parseDocument } from "yaml";
import { z } from "zod";
import type {
	AgentFileConfig,
	Capabilities,
	CapabilitiesFormat,
	CapabilitiesOptions,
} from "../types/capabilities";
import { logger } from "./logger";

const KNOWN_CAPABILITY_KEYS = new Set([
	"providers",
	"skills",
	"servers",
	"tools",
	"plugins",
	"options",
	"agents",
	"subagents",
	"rules",
	"hooks",
]);

const objectEntry = z.record(z.string(), z.unknown());

const capabilitiesSchema = z
	.object({
		providers: z.array(z.string()).optional(),
		skills: z.preprocess((val) => val ?? [], z.array(objectEntry)),
		servers: z.preprocess((val) => val ?? [], z.array(objectEntry)),
		tools: z.preprocess((val) => val ?? [], z.array(objectEntry)),
		plugins: z.preprocess((val) => val ?? [], z.array(objectEntry)),
		options: z.preprocess(
			(val) => val ?? {},
			z.record(z.string(), z.unknown()),
		),
		agents: z.record(z.string(), z.unknown()).optional(),
		subagents: z.preprocess((val) => val ?? [], z.array(objectEntry)),
		rules: z.preprocess((val) => val ?? [], z.array(objectEntry)),
		hooks: z.preprocess((val) => val ?? [], z.array(objectEntry)),
	})
	.passthrough();

export function normalizeCapabilities(parsed: unknown): Capabilities {
	if (
		parsed === null ||
		parsed === undefined ||
		typeof parsed !== "object" ||
		Array.isArray(parsed)
	) {
		throw new Error("capabilities file is empty or not a YAML/JSON object");
	}

	const result = capabilitiesSchema.parse(parsed);

	for (const key of Object.keys(parsed)) {
		if (!KNOWN_CAPABILITY_KEYS.has(key)) {
			logger.warn(`capabilities: unknown top-level key "${key}"`);
		}
	}

	return result as unknown as Capabilities;
}

export async function parseCapabilitiesFile(
	path: string,
	format: CapabilitiesFormat,
): Promise<Capabilities> {
	const file = Bun.file(path);
	const content = await file.text();

	if (format === "json") {
		return normalizeCapabilities(JSON.parse(content));
	} else {
		// js-yaml v5 throws on empty input instead of returning undefined, so guard
		// here to keep emitting our own clearer "empty or not an object" error.
		if (content.trim() === "") {
			return normalizeCapabilities(undefined);
		}
		return normalizeCapabilities(yaml.load(content));
	}
}

export function createDefaultCapabilities(): Capabilities {
	return {
		options: {
			toolExposure: "on-demand",
		},
		skills: [
			{
				id: "capabilities-manager",
				type: "github",
				def: {
					repo: "infragate/capa@capabilities-manager",
					description: "Guide for managing capabilities with capa CLI",
				},
			},
			{
				id: "bootstrap",
				type: "github",
				def: {
					repo: "infragate/capa@bootstrap",
					description:
						"Capify an existing project: discover skills/rules/hooks/MCP servers across all providers and synthesize capabilities.yaml",
				},
			},
		],
		servers: [],
		tools: [],
	};
}

export async function writeCapabilitiesFile(
	path: string,
	format: CapabilitiesFormat,
	capabilities: Capabilities,
): Promise<void> {
	let content: string;

	if (format === "json") {
		content = JSON.stringify(capabilities, null, 2);
	} else {
		content = yaml.dump(capabilities, { indent: 2 });
	}

	await Bun.write(path, content);
}

export type ArrayCapabilitySection =
	| "skills"
	| "servers"
	| "tools"
	| "plugins"
	| "subagents"
	| "rules"
	| "hooks";

export type CapabilityEntryPredicate = (
	entry: Record<string, unknown>,
) => boolean;

function asPlainObject(value: unknown): Record<string, unknown> | null {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

/**
 * Stable reorder identity for a capability entry.
 * Tools may reuse the same `id` across MCP servers, so MCP tools key on
 * `id::server::mcpTool` (server without leading `@`).
 */
export function capabilityEntryReorderKey(
	section: ArrayCapabilitySection,
	entry: Record<string, unknown>,
): string | null {
	if (typeof entry.id !== "string") return null;
	if (section === "tools" && entry.type === "mcp") {
		const def = asPlainObject(entry.def);
		if (
			def &&
			typeof def.server === "string" &&
			typeof def.tool === "string"
		) {
			return `${entry.id}::${def.server.replace(/^@/, "")}::${def.tool}`;
		}
	}
	return entry.id;
}

function yamlItemToObject(item: unknown): Record<string, unknown> | null {
	if (isMap(item)) {
		return (item as YAMLMap).toJSON() as Record<string, unknown>;
	}
	return asPlainObject(item);
}

/**
 * Append a single entry to one of the array-valued capability sections,
 * preserving the rest of the file verbatim — comments, key ordering, and
 * formatting all survive. Used by `capa add` so editing the file in place
 * never rearranges what the user already wrote.
 *
 * The entry is added at the end of the target section's list. If the section
 * is missing it is created.
 */
export async function appendCapabilityEntry(
	path: string,
	format: CapabilitiesFormat,
	section: ArrayCapabilitySection,
	entry: Record<string, unknown>,
): Promise<void> {
	const content = await Bun.file(path).text();

	if (format === "json") {
		const data = JSON.parse(content) as Record<string, unknown>;
		const list = Array.isArray(data[section])
			? (data[section] as unknown[])
			: [];
		list.push(entry);
		data[section] = list;
		await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
		return;
	}

	const doc = parseDocument(content);
	const existing = doc.get(section);
	if (isSeq(existing)) {
		existing.add(doc.createNode(entry));
	} else {
		doc.set(section, doc.createNode([entry]));
	}
	await Bun.write(path, doc.toString());
}

/**
 * Remove entries matching `predicate` from an array-valued capability section.
 * Returns the number of removed entries. YAML path preserves comments/ordering.
 */
export async function removeCapabilityEntry(
	path: string,
	format: CapabilitiesFormat,
	section: ArrayCapabilitySection,
	predicate: CapabilityEntryPredicate,
): Promise<number> {
	const content = await Bun.file(path).text();

	if (format === "json") {
		const data = JSON.parse(content) as Record<string, unknown>;
		const list = Array.isArray(data[section])
			? (data[section] as unknown[])
			: [];
		const next = list.filter((item) => {
			const obj = asPlainObject(item);
			return !(obj && predicate(obj));
		});
		const removed = list.length - next.length;
		data[section] = next;
		await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
		return removed;
	}

	const doc = parseDocument(content);
	const existing = doc.get(section);
	if (!isSeq(existing)) {
		return 0;
	}

	const seq = existing as YAMLSeq;
	let removed = 0;
	for (let i = seq.items.length - 1; i >= 0; i--) {
		const obj = yamlItemToObject(seq.items[i]);
		if (obj && predicate(obj)) {
			seq.delete(i);
			removed++;
		}
	}
	await Bun.write(path, doc.toString());
	return removed;
}

/**
 * Update the first entry matching `predicate` by merging/replacing via `updater`.
 * Returns true if an entry was updated.
 */
export async function updateCapabilityEntry(
	path: string,
	format: CapabilitiesFormat,
	section: ArrayCapabilitySection,
	predicate: CapabilityEntryPredicate,
	updater: (entry: Record<string, unknown>) => Record<string, unknown>,
): Promise<boolean> {
	const content = await Bun.file(path).text();

	if (format === "json") {
		const data = JSON.parse(content) as Record<string, unknown>;
		const list = Array.isArray(data[section])
			? (data[section] as unknown[])
			: [];
		let updated = false;
		data[section] = list.map((item) => {
			const obj = asPlainObject(item);
			if (!updated && obj && predicate(obj)) {
				updated = true;
				return updater({ ...obj });
			}
			return item;
		});
		if (updated) {
			await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
		}
		return updated;
	}

	const doc = parseDocument(content);
	const existing = doc.get(section);
	if (!isSeq(existing)) {
		return false;
	}

	const seq = existing as YAMLSeq;
	for (let i = 0; i < seq.items.length; i++) {
		const obj = yamlItemToObject(seq.items[i]);
		if (obj && predicate(obj)) {
			seq.set(i, doc.createNode(updater({ ...obj })));
			await Bun.write(path, doc.toString());
			return true;
		}
	}
	return false;
}

/**
 * Reorder entries in an array-valued capability section to match `orderedKeys`.
 * YAML path preserves item nodes (comments attached to entries survive).
 * `orderedKeys` must be a permutation of the section's current entry keys
 * (see {@link capabilityEntryReorderKey}).
 */
export async function reorderCapabilityEntries(
	path: string,
	format: CapabilitiesFormat,
	section: ArrayCapabilitySection,
	orderedKeys: string[],
): Promise<void> {
	if (new Set(orderedKeys).size !== orderedKeys.length) {
		throw new Error("ordered ids must be unique");
	}

	const content = await Bun.file(path).text();

	if (format === "json") {
		const data = JSON.parse(content) as Record<string, unknown>;
		const list = Array.isArray(data[section])
			? (data[section] as unknown[])
			: [];
		const byKey = new Map<string, unknown>();
		const withoutKey: unknown[] = [];
		for (const item of list) {
			const obj = asPlainObject(item);
			const key = obj ? capabilityEntryReorderKey(section, obj) : null;
			if (key) {
				if (byKey.has(key)) {
					throw new Error(`duplicate id "${key}" in ${section}`);
				}
				byKey.set(key, item);
			} else {
				withoutKey.push(item);
			}
		}

		assertPermutation(orderedKeys, [...byKey.keys()], section);

		const next: unknown[] = [];
		for (const key of orderedKeys) {
			next.push(byKey.get(key)!);
		}
		next.push(...withoutKey);
		data[section] = next;
		await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
		return;
	}

	const doc = parseDocument(content);
	const existing = doc.get(section);
	if (!isSeq(existing)) {
		if (orderedKeys.length === 0) return;
		throw new Error(`${section} section is missing or not a list`);
	}

	const seq = existing as YAMLSeq;
	const byKey = new Map<string, unknown>();
	const withoutKey: unknown[] = [];
	for (const item of seq.items) {
		const obj = yamlItemToObject(item);
		const key = obj ? capabilityEntryReorderKey(section, obj) : null;
		if (key) {
			if (byKey.has(key)) {
				throw new Error(`duplicate id "${key}" in ${section}`);
			}
			byKey.set(key, item);
		} else {
			withoutKey.push(item);
		}
	}

	assertPermutation(orderedKeys, [...byKey.keys()], section);

	const nextItems: unknown[] = [];
	for (const key of orderedKeys) {
		nextItems.push(byKey.get(key)!);
	}
	nextItems.push(...withoutKey);
	seq.items = nextItems as YAMLSeq["items"];
	await Bun.write(path, doc.toString());
}

function assertPermutation(
	orderedIds: string[],
	currentIds: string[],
	section: string,
): void {
	if (orderedIds.length !== currentIds.length) {
		throw new Error(
			`ids must include every ${section.slice(0, -1)} exactly once (got ${orderedIds.length}, expected ${currentIds.length})`,
		);
	}
	const current = new Set(currentIds);
	for (const id of orderedIds) {
		if (!current.has(id)) {
			throw new Error(`${section.slice(0, -1)} "${id}" not found`);
		}
	}
}

export type OptionsPatch = Partial<
	Pick<CapabilitiesOptions, "toolExposure" | "requiresCommands" | "security">
>;

/**
 * Shallow-merge `patch` into the top-level `options` object.
 * Missing `options` is created. Explicit `undefined` values remove that key.
 */
export async function upsertOptions(
	path: string,
	format: CapabilitiesFormat,
	patch: OptionsPatch,
): Promise<void> {
	const content = await Bun.file(path).text();

	if (format === "json") {
		const data = JSON.parse(content) as Record<string, unknown>;
		const options = asPlainObject(data.options) ?? {};
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined) {
				delete options[key];
			} else {
				options[key] = value;
			}
		}
		data.options = options;
		await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
		return;
	}

	const doc = parseDocument(content);
	const existing = doc.get("options");
	const options: Record<string, unknown> = isMap(existing)
		? ((existing as YAMLMap).toJSON() as Record<string, unknown>)
		: (asPlainObject(existing) ?? {});

	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) {
			delete options[key];
		} else {
			options[key] = value;
		}
	}
	doc.set("options", doc.createNode(options));
	await Bun.write(path, doc.toString());
}

/**
 * Replace (or remove) the top-level `agents` object.
 * Pass `null` to delete the key. YAML path preserves unrelated comments/keys.
 */
export async function upsertAgents(
	path: string,
	format: CapabilitiesFormat,
	agents: AgentFileConfig | null,
): Promise<void> {
	const content = await Bun.file(path).text();

	if (format === "json") {
		const data = JSON.parse(content) as Record<string, unknown>;
		if (agents === null) {
			delete data.agents;
		} else {
			data.agents = agents;
		}
		await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
		return;
	}

	const doc = parseDocument(content);
	if (agents === null) {
		doc.delete("agents");
	} else {
		doc.set("agents", doc.createNode(agents));
	}
	await Bun.write(path, doc.toString());
}
