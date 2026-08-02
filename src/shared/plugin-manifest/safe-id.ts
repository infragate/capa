import { slugify } from "../slug";

/**
 * Derive a filesystem-/capa-safe entry id from plugin frontmatter or a fallback
 * (e.g. filename stem). Strips path segments so `../evil` cannot escape
 * provider install directories.
 */
export function safePluginEntryId(
	candidate: string | undefined,
	fallback: string,
): string {
	const pickSegment = (raw: string): string => {
		const parts = raw
			.replace(/\\/g, "/")
			.split("/")
			.filter((p) => p.length > 0 && p !== "." && p !== "..");
		return parts.length > 0 ? parts[parts.length - 1]! : "";
	};

	const fromCandidate = candidate ? pickSegment(candidate.trim()) : "";
	const fromFallback = pickSegment(fallback.trim()) || "entry";
	const slug = slugify(fromCandidate || fromFallback)
		.replace(/[^a-z0-9_-]/g, "")
		.replace(/^-+|-+$/g, "");

	if (slug && /^[a-z_][a-z0-9_-]*$/i.test(slug)) return slug;

	const fb = slugify(fromFallback)
		.replace(/[^a-z0-9_-]/g, "")
		.replace(/^-+|-+$/g, "");
	return fb || "entry";
}
