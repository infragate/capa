import { describe, expect, it } from 'bun:test';
import {
	cliSubcommandFromArgv,
	shouldSkipVersionCheck,
} from '../cli-subcommand';

describe('cliSubcommandFromArgv', () => {
	it('returns the first non-option token', () => {
		expect(cliSubcommandFromArgv(['bun', 'capa', 'activity-ingest'])).toBe(
			'activity-ingest',
		);
		expect(
			cliSubcommandFromArgv([
				'bun',
				'capa',
				'--no-color',
				'activity-ingest',
				'--event',
				'beforeFileRead',
			]),
		).toBe('activity-ingest');
		expect(cliSubcommandFromArgv(['bun', 'capa', '-q', 'upgrade'])).toBe(
			'upgrade',
		);
		expect(cliSubcommandFromArgv(['bun', 'capa', 'install'])).toBe('install');
	});
});

describe('shouldSkipVersionCheck', () => {
	it('skips for upgrade and activity-ingest only', () => {
		expect(shouldSkipVersionCheck('upgrade')).toBe(true);
		expect(shouldSkipVersionCheck('activity-ingest')).toBe(true);
		expect(shouldSkipVersionCheck('install')).toBe(false);
		expect(shouldSkipVersionCheck(undefined)).toBe(false);
	});
});
