export { createClaudeMarketplaceAdapter, marketplaceIcon, siteFavicon } from "./adapter";
export {
	fetchClaudeMarketplace,
	parseClaudeMarketplaceSource,
	type FetchMarketplaceResult,
} from "./fetch";
export {
	formatPluginContentsMarkdown,
	pluginContentsToFiles,
	summarizeUnifiedManifest,
	type PluginContentsSummary,
} from "./plugin-contents";
export {
	classifyMarketplaceSource,
	marketplaceNameToSlug,
	parseMarketplaceJson,
} from "./parse";
export {
	createPluginInspector,
	getInstalledMarketplaceMetaPath,
	getInstalledMarketplacePath,
	getMarketplaceManagedDir,
	loadClaudeMarketplaceAdapter,
	MARKETPLACE_JSON_FILENAME,
	MARKETPLACE_META_FILENAME,
} from "./paths";
export {
	buildPluginInstallSnippet,
	buildRepoString,
	parseGithubOrGitlabUrl,
	sourceToInstallCoords,
	unsupportedSourceReason,
} from "./sources";
export type {
	InstallCoords,
	MarketplaceHost,
	MarketplaceMetaFile,
	MarketplaceOrigin,
	MarketplacePluginEntry,
	MarketplaceSource,
	ParsedMarketplace,
} from "./types";
