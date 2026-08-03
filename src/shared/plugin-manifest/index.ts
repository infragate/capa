export {
	type DiscoveredPluginEntry,
	detectAndParseManifest,
	discoverPluginEntries,
	findPluginInDirectory,
	resolveNestedPluginById,
} from "./detect";

export { resolvePluginServerDef, resolvePluginRootInString } from "./mcp-parser";
export { materializeCommandAsSkill } from "./commands-parser";
