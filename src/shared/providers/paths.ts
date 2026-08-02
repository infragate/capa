// Shared path constants consumed by every provider entry file.

import { homedir } from "os";
import { join } from "path";

let _xdgConfig: string | undefined;
try {
	// xdg-basedir is already a capa dependency; import lazily to keep the
	// module-level side-effects minimal.
	const mod = await import("xdg-basedir");
	_xdgConfig = mod.xdgConfig ?? undefined;
} catch {
	// fallback handled below
}

export const home = homedir();
export const configHome = _xdgConfig ?? join(home, ".config");
export const codexHome = process.env.CODEX_HOME?.trim() || join(home, ".codex");
export const claudeHome =
	process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
