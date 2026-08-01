import type { CapaDatabase } from "../db/database";

/**
 * Resolve variable expressions in a string.
 * Variables are in the format ${VarName}
 * Values are retrieved from the database for the given project.
 */
export function resolveVariables(
	input: string,
	projectId: string,
	db: CapaDatabase,
): string {
	const variablePattern = /\$\{([^}]+)\}/g;

	return input.replace(variablePattern, (match, varName) => {
		const value = db.getVariable(projectId, varName);
		if (value === null) {
			// Variable not found - return the original placeholder
			return match;
		}
		return value;
	});
}

/**
 * Extract all variable names from a string
 */
export function extractVariables(input: string): string[] {
	const variablePattern = /\$\{([^}]+)\}/g;
	const variables: string[] = [];
	let match;

	while ((match = variablePattern.exec(input)) !== null) {
		variables.push(match[1]);
	}

	return variables;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * Plugin-merged entries (skills, servers, subagents, hooks, rules) are stamped
 * with `sourcePlugin`. Their bodies can contain `${…}` as documentation or
 * agent prose — those must not be treated as capa credential placeholders.
 */
function isPluginSourcedObject(obj: Record<string, unknown>): boolean {
	return obj.sourcePlugin != null && typeof obj.sourcePlugin === "object";
}

/**
 * Recursively resolve variables in an object.
 * Only string *values* are resolved — object keys are left untouched.
 * Plugin-sourced entries (`sourcePlugin`) are skipped entirely.
 */
export function resolveVariablesInObject<T>(
	obj: T,
	projectId: string,
	db: CapaDatabase,
): T {
	if (typeof obj === "string") {
		return resolveVariables(obj, projectId, db) as T;
	}

	if (Array.isArray(obj)) {
		return obj.map((item) =>
			resolveVariablesInObject(item, projectId, db),
		) as T;
	}

	if (isPlainObject(obj)) {
		if (isPluginSourcedObject(obj)) {
			return obj;
		}
		const resolved: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			// Keys are never interpolated — only string values.
			resolved[key] = resolveVariablesInObject(value, projectId, db);
		}
		return resolved as T;
	}

	return obj;
}

/**
 * Check if a string or object contains unresolved variables.
 * Only string values are inspected; object keys and plugin-sourced entries
 * are ignored.
 */
export function hasUnresolvedVariables(input: unknown): boolean {
	if (typeof input === "string") {
		return /\$\{[^}]+\}/.test(input);
	}

	if (Array.isArray(input)) {
		return input.some(hasUnresolvedVariables);
	}

	if (isPlainObject(input)) {
		if (isPluginSourcedObject(input)) {
			return false;
		}
		return Object.values(input).some(hasUnresolvedVariables);
	}

	return false;
}

/**
 * Extract all unresolved variables from an object.
 *
 * Scans string values only (never object keys). Skips any entry stamped with
 * `sourcePlugin` so plugin-contributed content (e.g. subagent instructions)
 * cannot invent required project credentials.
 */
export function extractAllVariables(obj: unknown): string[] {
	const variables = new Set<string>();

	function extract(value: unknown) {
		if (typeof value === "string") {
			extractVariables(value).forEach((v) => variables.add(v));
		} else if (Array.isArray(value)) {
			value.forEach(extract);
		} else if (isPlainObject(value)) {
			if (isPluginSourcedObject(value)) {
				return;
			}
			Object.values(value).forEach(extract);
		}
	}

	extract(obj);
	return Array.from(variables);
}
