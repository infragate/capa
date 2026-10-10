export {
	type DiscoveredPluginEntry,
	detectAndParseManifest,
	discoverPluginEntries,
	findPluginInDirectory,
	resolveNestedPluginById,
} from "./detect";

export { resolvePluginServerDef, resolvePluginRootInString } from "./mcp-parser";
export { resolveAgentPluginsServerDef } from "./agent-plugins-parser";
export { materializeCommandAsSkill } from "./commands-parser";
