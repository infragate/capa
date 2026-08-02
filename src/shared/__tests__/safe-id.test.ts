import { describe, it, expect } from 'bun:test';
import {
	describeUnsafeCapabilityId,
	isSafeCapabilityId,
	isSafeHookId,
} from '../safe-id';

describe('isSafeCapabilityId', () => {
	it('accepts single-segment alphanumeric ids with ._-', () => {
		for (const id of [
			'ok',
			'audit-shell',
			'lint_staged',
			'a.b.c',
			'block-rm-rf',
			'hook123',
			'A',
			'9lives',
		]) {
			expect(isSafeCapabilityId(id)).toBe(true);
		}
	});

	it('rejects path separators, parent segments, and other characters', () => {
		for (const id of [
			'../escape',
			'foo/bar',
			'foo\\bar',
			'a..b',
			'.hidden',
			'-leading-dash',
			'has spaces',
			'has;semicolon',
			'with$shell',
			'',
			'plugin:name:id',
		]) {
			expect(isSafeCapabilityId(id)).toBe(false);
		}
	});

	it('rejects ids longer than 63 characters', () => {
		expect(isSafeCapabilityId('a'.repeat(63))).toBe(true);
		expect(isSafeCapabilityId('a'.repeat(64))).toBe(false);
	});

	it('keeps isSafeHookId as an alias', () => {
		expect(isSafeHookId('audit-shell')).toBe(true);
		expect(isSafeHookId('../x')).toBe(false);
	});

	it('describeUnsafeCapabilityId names the kind and id', () => {
		expect(describeUnsafeCapabilityId('Skill', '../x')).toContain('Skill');
		expect(describeUnsafeCapabilityId('Skill', '../x')).toContain('../x');
	});
});
