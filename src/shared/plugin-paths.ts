import { join } from "path";
import { getCapaDir } from "./config";

/**
 * Unpacked plugin trees live under `~/.capa/plugins/<projectId>/`
 * (same global capa home as hooks/cache). Shared by wrap, install, and passthrough.
 */
export function getProjectPluginsDir(projectId: string): string {
	return join(getCapaDir(), "plugins", projectId);
}
