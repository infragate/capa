export {
	type DiscoveredPluginEntry,
	detectAndParseManifest,
	discoverPluginEntries,
	findPluginInDirectory,
	resolveNestedPluginById,
} from "./detect";

export { resolvePluginServerDef, resolvePluginRootInString } from "./mcp-parser";
export {
	resolveAgentPluginsServerDef,
	stripControlChars,
} from "./agent-plugins-parser";
export { materializeCommandAsSkill } from "./commands-parser";
