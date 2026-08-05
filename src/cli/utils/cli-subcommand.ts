/**
 * Resolve the CLI subcommand from raw argv (after `node` / `bun` and script path).
 * Global root flags may precede the command token (`capa --no-color activity-ingest`).
 */
export function cliSubcommandFromArgv(argv: string[]): string | undefined {
	const rest = argv.slice(2);
	return rest.find((token) => token.length > 0 && !token.startsWith('-'));
}

/** Subcommands that must not append human-readable text to stdout after they run. */
export function shouldSkipVersionCheck(subcommand: string | undefined): boolean {
	return subcommand === 'upgrade' || subcommand === 'activity-ingest';
}
