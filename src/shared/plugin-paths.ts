import { createHash } from "crypto";
import { join } from "path";
import { getCapaDir } from "./config";
import { getPluginInstallId } from "./plugin-source";

/**
 * Unpacked plugin trees live under `~/.capa/plugins/<projectId>/`
 * (same global capa home as hooks/cache). Shared by wrap, install, and passthrough.
 */
export function getProjectPluginsDir(projectId: string): string {
	return join(getCapaDir(), "plugins", projectId);
}

/**
 * Persistent per-plugin data dirs (Agent Plugins `${PLUGIN_DATA}`) live under
 * `~/.capa/plugin-data/<projectId>/<dataId>/`, outside the plugins dir so
 * they survive plugin updates and the stale-copy sweep.
 */
export function getProjectPluginDataDir(projectId: string): string {
	return join(getCapaDir(), "plugin-data", projectId);
}

/**
 * Data dir name for one declared plugin source: a readable slug plus a hash
 * of where the plugin comes from. A plugin picks its own name, so keying by
 * name would let one plugin inherit another plugin's data.
 */
export function getPluginDataId(label: string, source: string): string {
	const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
	const slug = getPluginInstallId(label).slice(0, 40).replace(/-$/, "");
	return slug ? `${slug}-${hash}` : hash;
}
