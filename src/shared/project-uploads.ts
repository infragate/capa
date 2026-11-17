import { dirname, relative } from "path";
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
	if (kind === "skills" || !capabilitiesFilePath) {
		return normalizeRel(relative(canonicalizePath(projectRoot), canonicalizePath(absolutePath)));
	}
	return normalizeRel(
		relative(canonicalizePath(dirname(capabilitiesFilePath)), canonicalizePath(absolutePath)),
	);
}
