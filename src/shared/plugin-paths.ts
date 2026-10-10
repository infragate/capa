import { join } from "path";
import { getCapaDir } from "./config";

/**
 * Unpacked plugin trees live under `~/.capa/plugins/<projectId>/`
 * (same global capa home as hooks/cache). Shared by wrap, install, and passthrough.
 */
export function getProjectPluginsDir(projectId: string): string {
	return join(getCapaDir(), "plugins", projectId);
}

/**
 * Persistent per-plugin data dirs (Agent Plugins `${PLUGIN_DATA}`) live under
 * `~/.capa/plugin-data/<projectId>/<pluginId>/`, outside the plugins dir so
 * they survive plugin updates and the stale-copy sweep.
 */
export function getProjectPluginDataDir(projectId: string): string {
	return join(getCapaDir(), "plugin-data", projectId);
}
