import { describe, it, expect } from 'bun:test';
import { sortResultLines, buildAggregateOutput } from './aggregate';
import type { AggregateRule, NodeItem } from './models';

describe('sortResultLines', () => {
	const lines = [
		'ss://abc#🇺🇸 US-01',
		'vless://def#🇭🇰 HK-01',
		'vmess://ghi#🇸🇬 SG-01',
		'trojan://jkl#🇭🇰 HK-02'
	];

	it('should maintain original order when mode is none and no priority', () => {
		expect(sortResultLines(lines, 'none')).toEqual(lines);
	});

	it('should sort by name', () => {
		const sorted = sortResultLines(lines, 'name');
		expect(sorted[0]).toContain('HK-01');
		expect(sorted[1]).toContain('HK-02');
		expect(sorted[2]).toContain('SG-01');
		expect(sorted[3]).toContain('US-01');
	});

	it('should sort by protocol type', () => {
		const sorted = sortResultLines(lines, 'type');
		// ss, trojan, vless, vmess (alphabetical by protocol name)
		expect(sorted[0]).toContain('ss://');
		expect(sorted[1]).toContain('trojan://');
		expect(sorted[2]).toContain('vless://');
		expect(sorted[3]).toContain('vmess://');
	});

	it('should sort by region', () => {
		const sorted = sortResultLines(lines, 'region');
		// HK (🇭🇰), SG (🇸🇬), US (🇺🇸) - emojis are sorted too
		expect(sorted[0]).toContain('HK-01');
		expect(sorted[1]).toContain('HK-02');
		expect(sorted[2]).toContain('SG-01');
		expect(sorted[3]).toContain('US-01');
	});

	it('should prioritize based on keywords', () => {
		const sorted = sortResultLines(lines, 'none', 'SG\nHK');
		// SG group first, then HK group, then the rest (US)
		expect(sorted[0]).toContain('SG-01');
		expect(sorted[1]).toContain('HK-01');
		expect(sorted[2]).toContain('HK-02');
		expect(sorted[3]).toContain('US-01');
	});

	it('should prioritize based on keywords with spaces', () => {
		const spaceLines = [
			'ss://abc#🇺🇸 US Server 01',
			'vless://def#🇭🇰 HK Server 01'
		];
		const sorted = sortResultLines(spaceLines, 'none', 'HK Server');
		expect(sorted[0]).toContain('HK Server');
	});

	it('should sort within priority groups', () => {
		const unsortedLines = [
			'vless://def#🇭🇰 HK-02',
			'trojan://jkl#🇭🇰 HK-01',
			'vmess://ghi#🇸🇬 SG-01'
		];
		const sorted = sortResultLines(unsortedLines, 'name', 'HK');
		// HK group sorted by name: HK-01, HK-02. Then SG.
		expect(sorted[0]).toContain('HK-01');
		expect(sorted[1]).toContain('HK-02');
		expect(sorted[2]).toContain('SG-01');
	});
});

describe('Renaming Logic', () => {
	const mockNode: NodeItem = {
		id: 'n1',
		name: 'HK-Premium-01',
		type: 'vless',
		raw: 'vless://uuid@host:port?security=tls#HK-Premium-01',
		tags: [],
		enabled: true,
		updatedAt: '',
		source: 'single'
	};

	it('should apply literal renaming', async () => {
		const rule: AggregateRule = {
			id: 'r1',
			name: 'Test',
			nodeIds: ['n1'],
			subscriptionIds: [],
			excludeTagIds: [],
			renameMap: { 'HK-Premium-01': 'HK-01' },
			allowedTypes: [],
			prependRegionFlags: false,
			updatedAt: ''
		};
		const result = await buildAggregateOutput(rule, [mockNode], []);
		expect(result.content).toContain('#HK-01');
	});

	it('should apply regex renaming with capture groups', async () => {
		const rule: AggregateRule = {
			id: 'r1',
			name: 'Test',
			nodeIds: ['n1'],
			subscriptionIds: [],
			excludeTagIds: [],
			renameMap: {},
			renameRules: ['/HK-(.*)-(.*)/ = Hong Kong $2'],
			allowedTypes: [],
			prependRegionFlags: false,
			updatedAt: ''
		};
		const result = await buildAggregateOutput(rule, [mockNode], []);
		expect(result.content).toContain('#Hong%20Kong%2001');
	});

	it('should apply sequential renaming', async () => {
		const rule: AggregateRule = {
			id: 'r1',
			name: 'Test',
			nodeIds: ['n1'],
			subscriptionIds: [],
			excludeTagIds: [],
			renameMap: {},
			renameRules: ['/HK/ = HKG', '/HKG-(.*)/ = $1'],
			allowedTypes: [],
			prependRegionFlags: false,
			updatedAt: ''
		};
		const result = await buildAggregateOutput(rule, [mockNode], []);
		// HK-Premium-01 -> HKG-Premium-01 -> Premium-01
		expect(result.content).toContain('#Premium-01');
	});

	it('should support regex flags', async () => {
		const rule: AggregateRule = {
			id: 'r1',
			name: 'Test',
			nodeIds: ['n1'],
			subscriptionIds: [],
			excludeTagIds: [],
			renameMap: {},
			renameRules: ['/hk/i = Hong Kong'],
			allowedTypes: [],
			prependRegionFlags: false,
			updatedAt: ''
		};
		const result = await buildAggregateOutput(rule, [mockNode], []);
		expect(result.content).toContain('#Hong%20Kong-Premium-01');
	});
});
