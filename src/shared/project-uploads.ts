import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import type { Capabilities } from "../types/capabilities";
import {
	parseCapabilitiesFile,
	updateCapabilityEntry,
	upsertAgents,
} from "./capabilities";
import { logger } from "./logger";
import {
	LEGACY_UPLOAD_REL_DIR,
	type ProjectUploadKind,
	detectCapabilitiesFile,
	isCapabilitiesUnderDotConfig,
} from "./paths";

const UPLOAD_KINDS = new Set<ProjectUploadKind>([
	"skills",
	"rules",
	"instructions",
]);

export function isProjectUploadKind(value: string): value is ProjectUploadKind {
	return UPLOAD_KINDS.has(value as ProjectUploadKind);
}

function normalizeRel(rel: string): string {
	return rel.split(/[/\\]/).filter(Boolean).join("/");
}

/** True when `relPath` points at (or under) the legacy `.capa/imports` tree. */
export function isLegacyImportRelPath(relPath: string): boolean {
	const n = normalizeRel(relPath.replace(/^\.\//, ""));
	return n === LEGACY_UPLOAD_REL_DIR || n.startsWith(`${LEGACY_UPLOAD_REL_DIR}/`);
}

type ClassifiedImport = {
	/** Project-relative path of the on-disk asset */
	projectRel: string;
	kind: ProjectUploadKind;
};

/**
 * Resolve a capabilities-stored path to a project-relative path.
 * Skills resolve from project root; rules/instructions from the capabilities directory.
 */
function toProjectRel(
	projectRoot: string,
	capabilitiesFilePath: string,
	kind: ProjectUploadKind,
	rawPath: string,
): string {
	const root = resolve(projectRoot);
	const base = kind === "skills" ? root : dirname(resolve(capabilitiesFilePath));
	const abs = resolve(base, rawPath);
	return normalizeRel(relative(root, abs));
}

/**
 * Path to store in the capabilities file for an uploaded asset.
 * Skills: project-relative. Rules/instructions: relative to the capabilities file.
 */
export function pathStoredInCapabilities(opts: {
	projectRoot: string;
	capabilitiesFilePath: string | null;
	kind: ProjectUploadKind;
	absolutePath: string;
}): string {
	const { projectRoot, capabilitiesFilePath, kind, absolutePath } = opts;
	if (kind === "skills" || !capabilitiesFilePath) {
		return normalizeRel(relative(resolve(projectRoot), absolutePath));
	}
	return normalizeRel(
		relative(dirname(resolve(capabilitiesFilePath)), absolutePath),
	);
}

/**
 * Collect local paths under `.capa/imports` referenced from capabilities,
 * classified by the section that owns them. First section wins on duplicates.
 */
export function classifyLegacyImportsFromCapabilities(
	projectRoot: string,
	capabilitiesFilePath: string,
	capabilities: Capabilities,
): ClassifiedImport[] {
	const out: ClassifiedImport[] = [];
	const seen = new Set<string>();

	const push = (rawPath: string | undefined, kind: ProjectUploadKind) => {
		if (!rawPath) return;
		const projectRel = toProjectRel(
			projectRoot,
			capabilitiesFilePath,
			kind,
			rawPath,
		);
		if (projectRel.startsWith("..") || projectRel === "") return;
		if (!isLegacyImportRelPath(projectRel)) return;
		if (seen.has(projectRel)) return;
		seen.add(projectRel);
		out.push({ projectRel, kind });
	};

	for (const skill of capabilities.skills ?? []) {
		if (skill.type === "local") push(skill.def?.path, "skills");
	}
	for (const rule of capabilities.rules ?? []) {
		if (rule.type === "local") push(rule.path, "rules");
	}
	const agents = capabilities.agents;
	if (
		agents?.base?.path &&
		(agents.base.type === "local" ||
			(!agents.base.type && !agents.base.ref && !agents.base.def))
	) {
		push(agents.base.path, "instructions");
	}
	for (const snippet of agents?.additional ?? []) {
		if (snippet.type === "local") push(snippet.path, "instructions");
	}

	return out;
}

function uniqueDestPath(destAbs: string): string {
	if (!existsSync(destAbs)) return destAbs;
	const dir = dirname(destAbs);
	const base = basename(destAbs);
	const dot = base.lastIndexOf(".");
	const stem = dot > 0 ? base.slice(0, dot) : base;
	const ext = dot > 0 ? base.slice(dot) : "";
	for (let i = 1; i < 1000; i++) {
		const candidate = join(dir, `${stem}-${i}${ext}`);
		if (!existsSync(candidate)) return candidate;
	}
	return join(dir, `${stem}-${Date.now()}${ext}`);
}

function tryRemoveEmptyDirs(startAbs: string, stopAbs: string): void {
	let cur = startAbs;
	const stop = resolve(stopAbs);
	while (cur !== stop && cur.startsWith(stop)) {
		try {
			if (readdirSync(cur).length > 0) return;
			rmdirSync(cur);
		} catch {
			return;
		}
		const parent = dirname(cur);
		if (parent === cur) return;
		cur = parent;
	}
}

type StoredRewrite = {
	kind: ProjectUploadKind;
	projectRelOld: string;
	newStored: string;
};

function matchOldPath(
	stored: string | undefined,
	rewrite: StoredRewrite,
	projectRoot: string,
	capabilitiesFilePath: string,
): boolean {
	if (!stored) return false;
	const n = normalizeRel(stored.replace(/^\.\//, ""));
	if (n === rewrite.projectRelOld) return true;
	const asProject = toProjectRel(
		projectRoot,
		capabilitiesFilePath,
		rewrite.kind,
		stored,
	);
	return asProject === rewrite.projectRelOld;
}

/**
 * Move `.capa/imports` assets referenced from capabilities into
 * `.config/capabilities/{skills,rules,instructions}` and rewrite those paths.
 * Leaves unreferenced legacy files in place.
 */
export async function ensureProjectUploadsMigrated(
	projectRoot: string,
): Promise<void> {
	const detected = await detectCapabilitiesFile(projectRoot);
	if (!detected || !isCapabilitiesUnderDotConfig(projectRoot, detected.path)) {
		return;
	}

	const rootAbs = resolve(projectRoot);
	const legacyAbs = join(rootAbs, LEGACY_UPLOAD_REL_DIR);
	if (!existsSync(legacyAbs)) return;

	let capabilities: Capabilities;
	try {
		capabilities = await parseCapabilitiesFile(detected.path, detected.format);
	} catch (err) {
		logger.warn(
			`Skipping upload migration: failed to parse capabilities (${err instanceof Error ? err.message : String(err)})`,
		);
		return;
	}

	const classified = classifyLegacyImportsFromCapabilities(
		projectRoot,
		detected.path,
		capabilities,
	);
	if (classified.length === 0) return;

	const storedRewrites: StoredRewrite[] = [];

	for (const item of classified) {
		const srcAbs = join(rootAbs, item.projectRel);
		if (!existsSync(srcAbs)) continue;

		const destDirAbs = join(rootAbs, ".config", "capabilities", item.kind);
		mkdirSync(destDirAbs, { recursive: true });

		const destAbs = uniqueDestPath(join(destDirAbs, basename(srcAbs)));
		renameSync(srcAbs, destAbs);
		tryRemoveEmptyDirs(dirname(srcAbs), legacyAbs);

		const newStored = pathStoredInCapabilities({
			projectRoot,
			capabilitiesFilePath: detected.path,
			kind: item.kind,
			absolutePath: destAbs,
		});
		storedRewrites.push({
			kind: item.kind,
			projectRelOld: item.projectRel,
			newStored,
		});
	}

	if (storedRewrites.length === 0) return;

	for (const rewrite of storedRewrites) {
		if (rewrite.kind === "skills") {
			await updateCapabilityEntry(
				detected.path,
				detected.format,
				"skills",
				(e) => {
					const path =
						typeof e.def === "object" && e.def && "path" in e.def
							? String((e.def as { path?: unknown }).path ?? "")
							: undefined;
					return (
						e.type === "local" &&
						matchOldPath(path, rewrite, projectRoot, detected.path)
					);
				},
				(e) => {
					const def =
						typeof e.def === "object" && e.def
							? { ...(e.def as Record<string, unknown>) }
							: {};
					def.path = rewrite.newStored;
					return { ...e, def };
				},
			);
		} else if (rewrite.kind === "rules") {
			await updateCapabilityEntry(
				detected.path,
				detected.format,
				"rules",
				(e) =>
					e.type === "local" &&
					matchOldPath(
						String(e.path ?? ""),
						rewrite,
						projectRoot,
						detected.path,
					),
				(e) => ({ ...e, path: rewrite.newStored }),
			);
		}
	}

	const instructionRewrites = storedRewrites.filter(
		(r) => r.kind === "instructions",
	);
	if (instructionRewrites.length > 0 && capabilities.agents) {
		const agents = structuredClone(capabilities.agents);
		if (agents.base?.path) {
			for (const rewrite of instructionRewrites) {
				if (
					matchOldPath(agents.base.path, rewrite, projectRoot, detected.path)
				) {
					agents.base = {
						...agents.base,
						type: agents.base.type ?? "local",
						path: rewrite.newStored,
					};
				}
			}
		}
		if (agents.additional) {
			agents.additional = agents.additional.map((s) => {
				if (s.type !== "local" || !s.path) return s;
				for (const rewrite of instructionRewrites) {
					if (matchOldPath(s.path, rewrite, projectRoot, detected.path)) {
						return { ...s, path: rewrite.newStored };
					}
				}
				return s;
			});
		}
		await upsertAgents(detected.path, detected.format, agents);
	}

	logger.info(
		`Migrated ${storedRewrites.length} upload(s) from ${LEGACY_UPLOAD_REL_DIR} to .config/capabilities/`,
	);
}
