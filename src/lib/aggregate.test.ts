import { describe, it, expect } from 'bun:test';
import { sortResultLines } from './aggregate';

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
