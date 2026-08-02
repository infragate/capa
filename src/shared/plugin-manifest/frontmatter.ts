import * as yaml from "js-yaml";

/**
 * Split markdown into optional YAML frontmatter and body.
 * Returns null frontmatter when the file has no `---` fence.
 */
export function splitMarkdownFrontmatter(content: string): {
	frontmatter: Record<string, unknown> | null;
	body: string;
} {
	const trimmed = content.replace(/^\uFEFF/, "");
	const match = trimmed.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
	if (!match) {
		return { frontmatter: null, body: trimmed.trim() };
	}
	const raw = match[1];
	const body = (match[2] ?? "").trim();
	let parsed: unknown;
	try {
		parsed = yaml.load(raw);
	} catch {
		// Cursor-style unquoted globs starting with `*`
		const requoted = raw.replace(
			/^([ \t]*[\w-]+[ \t]*:[ \t]*)(\*[^\n#]*?)(\s*)$/gm,
			(_m, prefix, value, trailing) =>
				`${prefix}"${(value as string).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"${trailing}`,
		);
		try {
			parsed = yaml.load(requoted);
		} catch {
			return { frontmatter: null, body: trimmed.trim() };
		}
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { frontmatter: null, body };
	}
	return { frontmatter: parsed as Record<string, unknown>, body };
}

export function asStringArray(value: unknown): string[] {
	if (typeof value === "string") {
		return value
			.split(/[,|]/)
			.map((s) => s.trim())
			.filter(Boolean);
	}
	if (Array.isArray(value)) {
		return value.filter((v): v is string => typeof v === "string" && v.length > 0);
	}
	return [];
}

export function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

export function asOptionalBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		if (["true", "yes", "on", "1"].includes(v)) return true;
		if (["false", "no", "off", "0"].includes(v)) return false;
	}
	return undefined;
}
