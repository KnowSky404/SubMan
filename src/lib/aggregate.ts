import type { AggregateRule, NodeItem, SubscriptionItem } from '$lib/models';

export type AggregateBuildResult = {
	content: string;
	lines: number;
	warnings: string[];
	errors: string[];
};

type RegionFlagRule = {
	code: string;
	keywords: string[];
};

const KNOWN_PROXY_TYPES = new Set(['vless', 'vmess', 'trojan', 'ss', 'ssr', 'hysteria2', 'tuic']);
const LEADING_FLAG_REGEX = /^(?:[\u{1F1E6}-\u{1F1FF}]{2})\s*/u;
const REGION_FLAG_RULES: RegionFlagRule[] = [
	{ code: 'HK', keywords: ['HK', 'HKG', 'HONG KONG', 'HONGKONG'] },
	{ code: 'TW', keywords: ['TW', 'TWN', 'TAIWAN', 'TAIPEI'] },
	{ code: 'JP', keywords: ['JP', 'JPN', 'JAPAN', 'TOKYO', 'OSAKA'] },
	{ code: 'SG', keywords: ['SG', 'SGP', 'SINGAPORE'] },
	{ code: 'KR', keywords: ['KR', 'KOR', 'KOREA', 'SEOUL'] },
	{ code: 'US', keywords: ['US', 'USA', 'UNITED STATES', 'AMERICA', 'NEW YORK', 'LOS ANGELES', 'SEATTLE', 'SAN JOSE'] },
	{ code: 'GB', keywords: ['UK', 'GB', 'GBR', 'UNITED KINGDOM', 'BRITAIN', 'ENGLAND', 'LONDON'] },
	{ code: 'DE', keywords: ['DE', 'DEU', 'GERMANY', 'FRANKFURT'] },
	{ code: 'FR', keywords: ['FR', 'FRA', 'FRANCE', 'PARIS'] },
	{ code: 'NL', keywords: ['NL', 'NLD', 'NETHERLANDS', 'AMSTERDAM'] },
	{ code: 'CA', keywords: ['CA', 'CAN', 'CANADA', 'TORONTO', 'VANCOUVER'] },
	{ code: 'AU', keywords: ['AU', 'AUS', 'AUSTRALIA', 'SYDNEY', 'MELBOURNE'] },
	{ code: 'CN', keywords: ['CN', 'CHN', 'CHINA', 'BEIJING', 'SHANGHAI', 'GUANGZHOU', 'SHENZHEN'] },
	{ code: 'MO', keywords: ['MO', 'MAC', 'MACAU'] },
	{ code: 'IN', keywords: ['IN', 'IND', 'INDIA'] },
	{ code: 'TR', keywords: ['TR', 'TUR', 'TURKEY', 'TURKIYE'] },
	{ code: 'RU', keywords: ['RU', 'RUS', 'RUSSIA', 'MOSCOW'] },
	{ code: 'BR', keywords: ['BR', 'BRA', 'BRAZIL'] },
	{ code: 'VN', keywords: ['VN', 'VNM', 'VIETNAM'] },
	{ code: 'TH', keywords: ['TH', 'THA', 'THAILAND', 'BANGKOK'] },
	{ code: 'MY', keywords: ['MY', 'MYS', 'MALAYSIA'] },
	{ code: 'ID', keywords: ['ID', 'IDN', 'INDONESIA', 'JAKARTA'] },
	{ code: 'PH', keywords: ['PH', 'PHL', 'PHILIPPINES', 'MANILA'] },
	{ code: 'AE', keywords: ['AE', 'ARE', 'UAE', 'DUBAI', 'ABU DHABI'] },
	{ code: 'SA', keywords: ['SA', 'SAU', 'SAUDI', 'RIYADH'] },
	{ code: 'CH', keywords: ['CH', 'CHE', 'SWITZERLAND', 'ZURICH'] },
	{ code: 'SE', keywords: ['SE', 'SWE', 'SWEDEN'] },
	{ code: 'NO', keywords: ['NO', 'NOR', 'NORWAY'] },
	{ code: 'FI', keywords: ['FI', 'FIN', 'FINLAND'] },
	{ code: 'IT', keywords: ['IT', 'ITA', 'ITALY', 'MILAN'] },
	{ code: 'ES', keywords: ['ES', 'ESP', 'SPAIN', 'MADRID'] },
	{ code: 'PL', keywords: ['PL', 'POL', 'POLAND'] }
];

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeRegionName(name: string): string {
	const normalized = name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
	return normalized ? ` ${normalized} ` : ' ';
}

function toFlagEmoji(countryCode: string): string {
	if (!/^[A-Z]{2}$/.test(countryCode)) {
		return '';
	}

	return Array.from(countryCode)
		.map((char) => String.fromCodePoint(char.charCodeAt(0) + 127397))
		.join('');
}

function inferRegionCodeFromName(name: string): string | null {
	const normalizedName = normalizeRegionName(name);

	for (const rule of REGION_FLAG_RULES) {
		if (rule.keywords.some((keyword) => normalizedName.includes(` ${keyword} `))) {
			return rule.code;
		}
	}

	return null;
}

function prependRegionFlag(name: string): string {
	const trimmed = name.trim();
	if (!trimmed || LEADING_FLAG_REGEX.test(trimmed)) {
		return name;
	}

	const regionCode = inferRegionCodeFromName(trimmed);
	if (!regionCode) {
		return name;
	}

	const flag = toFlagEmoji(regionCode);
	return flag ? `${flag} ${trimmed}` : name;
}

function isExcluded(node: NodeItem, excludeTags: string[]): boolean {
	if (excludeTags.length === 0) {
		return false;
	}
	const tags = node.tags.map((tag) => normalize(tag.label)).concat(node.tags.map((tag) => normalize(tag.id)));
	return excludeTags.some((tag) => tags.includes(normalize(tag)));
}

function decodeBase64Binary(value: string): string | null {
	try {
		const compact = value.trim().replace(/\s+/g, '');
		return atob(compact);
	} catch {
		return null;
	}
}

function decodeBase64(value: string): string | null {
	const binary = decodeBase64Binary(value);
	if (!binary) {
		return null;
	}

	try {
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return binary;
	}
}

function encodeBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function replaceLineName(rawLine: string, nextName: string): string {
	if (!nextName) {
		return rawLine;
	}

	const hashIndex = rawLine.indexOf('#');
	if (hashIndex !== -1) {
		const base = rawLine.slice(0, hashIndex);
		return `${base}#${encodeURIComponent(nextName)}`;
	}

	if (rawLine.startsWith('vmess://')) {
		const payload = rawLine.slice('vmess://'.length);
		const decoded = decodeBase64(payload);
		if (!decoded) {
			return rawLine;
		}

		try {
			const parsed = JSON.parse(decoded) as { ps?: string };
			parsed.ps = nextName;
			return `vmess://${encodeBase64(JSON.stringify(parsed))}`;
		} catch {
			return rawLine;
		}
	}

	return rawLine;
}

function applyRenameByName(rawLine: string, originalName: string | null, renameMap: Record<string, string>): string {
	if (!originalName) {
		return rawLine;
	}

	const nextName = renameMap[originalName];
	if (!nextName) {
		return rawLine;
	}

	return replaceLineName(rawLine, nextName);
}

function applyRegionFlagByName(rawLine: string): string {
	const originalName = getLineName(rawLine);
	if (!originalName) {
		return rawLine;
	}

	const nextName = prependRegionFlag(originalName);
	if (nextName === originalName) {
		return rawLine;
	}

	return replaceLineName(rawLine, nextName);
}

function getLineName(rawLine: string): string | null {
	const hashIndex = rawLine.lastIndexOf('#');
	if (hashIndex > -1) {
		const name = rawLine.slice(hashIndex + 1);
		return name ? decodeURIComponent(name) : null;
	}

	if (rawLine.startsWith('vmess://')) {
		const payload = rawLine.slice('vmess://'.length);
		const decoded = decodeBase64(payload);
		if (decoded) {
			try {
				const parsed = JSON.parse(decoded) as { ps?: string };
				return parsed.ps ?? null;
			} catch {
				return null;
			}
		}
	}

	return null;
}

function inferTypeFromLine(line: string): NodeItem['type'] {
	const index = line.indexOf('://');
	if (index <= 0) {
		return 'other';
	}

	const scheme = line.slice(0, index).toLowerCase();
	if (scheme === 'hy2') {
		return 'hysteria2';
	}

	if (KNOWN_PROXY_TYPES.has(scheme)) {
		return scheme as NodeItem['type'];
	}

	return 'other';
}

function filterByAllowedTypes(lines: string[], allowedTypes: NodeItem['type'][] | null): string[] {
	if (!allowedTypes || allowedTypes.length === 0) {
		return lines;
	}

	return lines.filter((line) => allowedTypes.includes(inferTypeFromLine(line)));
}

function looksLikeBase64(value: string): boolean {
	const compact = value.trim().replace(/\s+/g, '');
	if (!compact || compact.length % 4 !== 0) {
		return false;
	}
	return /^[A-Za-z0-9+/=]+$/.test(compact);
}

function normalizeContent(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.join('\n');
}

async function loadSubscriptionContent(url: string): Promise<{ content: string; warning?: string }> {
	const res = await fetch(url);
	if (!res.ok) {
		return { content: '', warning: `Failed to fetch ${url}` };
	}
	const text = await res.text();
	if (looksLikeBase64(text)) {
		const decoded = decodeBase64(text);
		if (decoded && decoded.includes('://')) {
			return { content: decoded };
		}
	}
	return { content: text };
}

export async function buildAggregateOutput(
	rule: AggregateRule,
	nodes: NodeItem[],
	subscriptions: SubscriptionItem[]
): Promise<AggregateBuildResult> {
	const warnings: string[] = [];
	const errors: string[] = [];
	const excludeTags = rule.excludeTagIds.map((tag) => normalize(tag));
	const allowedTypes = rule.allowedTypes && rule.allowedTypes.length > 0 ? rule.allowedTypes : null;

	const selectedNodes = nodes.filter(
		(node) =>
			node.enabled &&
			rule.nodeIds.includes(node.id) &&
			!isExcluded(node, excludeTags) &&
			(!allowedTypes || allowedTypes.includes(node.type))
	);
	const selectedSubs = subscriptions.filter(
		(sub) => sub.enabled && rule.subscriptionIds.includes(sub.id)
	);

	const nodeLines = selectedNodes.map((node) =>
		applyRegionFlagByName(
			applyRenameByName(node.raw, node.name.trim() || getLineName(node.raw), rule.renameMap)
		)
	);

	const subscriptionLines: string[] = [];
	for (const sub of selectedSubs) {
		try {
			const { content, warning } = await loadSubscriptionContent(sub.url);
			if (warning) {
				warnings.push(warning);
				continue;
			}
			if (!content) {
				continue;
			}
			subscriptionLines.push(...normalizeContent(content).split('\n'));
		} catch (err) {
			errors.push(err instanceof Error ? err.message : `Failed to load ${sub.url}`);
		}
	}

	const renamedSubscriptionLines = subscriptionLines.map((line) =>
		applyRegionFlagByName(applyRenameByName(line, getLineName(line), rule.renameMap))
	);
	const filteredSubscriptionLines = filterByAllowedTypes(renamedSubscriptionLines, allowedTypes);
	const content = normalizeContent([...nodeLines, ...filteredSubscriptionLines].join('\n'));
	return {
		content,
		lines: content ? content.split('\n').length : 0,
		warnings,
		errors
	};
}
