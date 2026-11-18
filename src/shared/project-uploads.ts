import { dirname, isAbsolute, join, relative, resolve } from "path";
import { canonicalizePath, type ProjectUploadKind } from "./paths";

export function isProjectUploadKind(value: string): value is ProjectUploadKind {
  return value === "skills" || value === "rules" || value === "instructions";
}

function normalizeRel(value: string): string {
  return value.split(/[/\\]/).join("/");
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
	const real = canonicalizePath(absolutePath);
	const fromRoot = relative(canonicalizePath(projectRoot), real);
	if (kind === "skills" || !capabilitiesFilePath) return normalizeRel(fromRoot);
	// Install resolves these from the config's logical directory, so measure from
	// there: a linked .config must not leak its real location into the path.
	const target = isAbsolute(fromRoot) ? real : join(resolve(projectRoot), fromRoot);
	return normalizeRel(relative(dirname(resolve(capabilitiesFilePath)), target));
}
