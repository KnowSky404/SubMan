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
	{ code: 'EU', keywords: ['EU', 'EUR', 'EUROPE'] },
	{ code: 'HK', keywords: ['HK', 'HKG', 'HONG KONG', 'HONGKONG'] },
	{ code: 'MO', keywords: ['MO', 'MAC', 'MACAU'] },
	{ code: 'TW', keywords: ['TW', 'TWN', 'TAIWAN', 'TAIPEI', 'KAOHSIUNG'] },
	{ code: 'JP', keywords: ['JP', 'JPN', 'JAPAN', 'TOKYO', 'OSAKA', 'NAGOYA'] },
	{ code: 'SG', keywords: ['SG', 'SGP', 'SINGAPORE'] },
	{ code: 'KR', keywords: ['KR', 'KOR', 'KOREA', 'SOUTH KOREA', 'SEOUL', 'BUSAN'] },
	{ code: 'US', keywords: ['US', 'USA', 'UNITED STATES', 'AMERICA', 'NEW YORK', 'LOS ANGELES', 'SEATTLE', 'SAN JOSE', 'SAN FRANCISCO', 'CHICAGO', 'DALLAS', 'MIAMI', 'LAS VEGAS', 'PHOENIX'] },
	{ code: 'CA', keywords: ['CA', 'CAN', 'CANADA', 'TORONTO', 'VANCOUVER', 'MONTREAL'] },
	{ code: 'MX', keywords: ['MX', 'MEX', 'MEXICO', 'MEXICO CITY'] },
	{ code: 'GB', keywords: ['UK', 'GB', 'GBR', 'UNITED KINGDOM', 'BRITAIN', 'ENGLAND', 'LONDON', 'MANCHESTER'] },
	{ code: 'IE', keywords: ['IE', 'IRL', 'IRELAND', 'DUBLIN'] },
	{ code: 'DE', keywords: ['DE', 'DEU', 'GERMANY', 'FRANKFURT', 'BERLIN', 'MUNICH'] },
	{ code: 'FR', keywords: ['FR', 'FRA', 'FRANCE', 'PARIS', 'MARSEILLE'] },
	{ code: 'NL', keywords: ['NL', 'NLD', 'NETHERLANDS', 'AMSTERDAM', 'ROTTERDAM'] },
	{ code: 'BE', keywords: ['BE', 'BEL', 'BELGIUM', 'BRUSSELS'] },
	{ code: 'LU', keywords: ['LU', 'LUX', 'LUXEMBOURG'] },
	{ code: 'CH', keywords: ['CH', 'CHE', 'SWITZERLAND', 'ZURICH', 'GENEVA'] },
	{ code: 'AT', keywords: ['AT', 'AUT', 'AUSTRIA', 'VIENNA'] },
	{ code: 'IT', keywords: ['IT', 'ITA', 'ITALY', 'MILAN', 'ROME'] },
	{ code: 'ES', keywords: ['ES', 'ESP', 'SPAIN', 'MADRID', 'BARCELONA'] },
	{ code: 'PT', keywords: ['PT', 'PRT', 'PORTUGAL', 'LISBON'] },
	{ code: 'SE', keywords: ['SE', 'SWE', 'SWEDEN', 'STOCKHOLM'] },
	{ code: 'NO', keywords: ['NO', 'NOR', 'NORWAY', 'OSLO'] },
	{ code: 'FI', keywords: ['FI', 'FIN', 'FINLAND', 'HELSINKI'] },
	{ code: 'DK', keywords: ['DK', 'DNK', 'DENMARK', 'COPENHAGEN'] },
	{ code: 'IS', keywords: ['IS', 'ISL', 'ICELAND', 'REYKJAVIK'] },
	{ code: 'PL', keywords: ['PL', 'POL', 'POLAND', 'WARSAW'] },
	{ code: 'CZ', keywords: ['CZ', 'CZE', 'CZECH', 'PRAGUE'] },
	{ code: 'SK', keywords: ['SK', 'SVK', 'SLOVAKIA', 'BRATISLAVA'] },
	{ code: 'HU', keywords: ['HU', 'HUN', 'HUNGARY', 'BUDAPEST'] },
	{ code: 'RO', keywords: ['RO', 'ROU', 'ROMANIA', 'BUCHAREST'] },
	{ code: 'BG', keywords: ['BG', 'BGR', 'BULGARIA', 'SOFIA'] },
	{ code: 'GR', keywords: ['GR', 'GRC', 'GREECE', 'ATHENS'] },
	{ code: 'HR', keywords: ['HR', 'HRV', 'CROATIA', 'ZAGREB'] },
	{ code: 'SI', keywords: ['SI', 'SVN', 'SLOVENIA', 'LJUBLJANA'] },
	{ code: 'RS', keywords: ['RS', 'SRB', 'SERBIA', 'BELGRADE'] },
	{ code: 'UA', keywords: ['UA', 'UKR', 'UKRAINE', 'KYIV', 'KIEV'] },
	{ code: 'TR', keywords: ['TR', 'TUR', 'TURKEY', 'TURKIYE', 'ISTANBUL'] },
	{ code: 'RU', keywords: ['RU', 'RUS', 'RUSSIA', 'MOSCOW', 'SAINT PETERSBURG'] },
	{ code: 'IL', keywords: ['IL', 'ISR', 'ISRAEL', 'TEL AVIV'] },
	{ code: 'AE', keywords: ['AE', 'ARE', 'UAE', 'DUBAI', 'ABU DHABI'] },
	{ code: 'SA', keywords: ['SA', 'SAU', 'SAUDI', 'RIYADH', 'JEDDAH'] },
	{ code: 'QA', keywords: ['QA', 'QAT', 'QATAR', 'DOHA'] },
	{ code: 'EG', keywords: ['EG', 'EGY', 'EGYPT', 'CAIRO'] },
	{ code: 'ZA', keywords: ['ZA', 'ZAF', 'SOUTH AFRICA', 'JOHANNESBURG'] },
	{ code: 'IN', keywords: ['IN', 'IND', 'INDIA', 'MUMBAI', 'DELHI', 'BANGALORE'] },
	{ code: 'PK', keywords: ['PK', 'PAK', 'PAKISTAN', 'KARACHI'] },
	{ code: 'BD', keywords: ['BD', 'BGD', 'BANGLADESH', 'DHAKA'] },
	{ code: 'LK', keywords: ['LK', 'LKA', 'SRI LANKA', 'COLOMBO'] },
	{ code: 'NP', keywords: ['NP', 'NPL', 'NEPAL', 'KATHMANDU'] },
	{ code: 'KZ', keywords: ['KZ', 'KAZ', 'KAZAKHSTAN', 'ALMATY'] },
	{ code: 'UZ', keywords: ['UZ', 'UZB', 'UZBEKISTAN', 'TASHKENT'] },
	{ code: 'TH', keywords: ['TH', 'THA', 'THAILAND', 'BANGKOK'] },
	{ code: 'VN', keywords: ['VN', 'VNM', 'VIETNAM', 'HANOI', 'HO CHI MINH', 'SAIGON'] },
	{ code: 'MY', keywords: ['MY', 'MYS', 'MALAYSIA', 'KUALA LUMPUR'] },
	{ code: 'ID', keywords: ['ID', 'IDN', 'INDONESIA', 'JAKARTA'] },
	{ code: 'PH', keywords: ['PH', 'PHL', 'PHILIPPINES', 'MANILA'] },
	{ code: 'KH', keywords: ['KH', 'KHM', 'CAMBODIA', 'PHNOM PENH'] },
	{ code: 'LA', keywords: ['LA', 'LAO', 'LAOS', 'VIENTIANE'] },
	{ code: 'MM', keywords: ['MM', 'MMR', 'MYANMAR', 'YANGON'] },
	{ code: 'CN', keywords: ['CN', 'CHN', 'CHINA', 'MAINLAND', 'BEIJING', 'SHANGHAI', 'GUANGZHOU', 'SHENZHEN', 'HANGZHOU', 'CHENGDU'] },
	{ code: 'AU', keywords: ['AU', 'AUS', 'AUSTRALIA', 'SYDNEY', 'MELBOURNE', 'BRISBANE', 'PERTH'] },
	{ code: 'NZ', keywords: ['NZ', 'NZL', 'NEW ZEALAND', 'AUCKLAND'] },
	{ code: 'BR', keywords: ['BR', 'BRA', 'BRAZIL', 'SAO PAULO'] },
	{ code: 'AR', keywords: ['AR', 'ARG', 'ARGENTINA', 'BUENOS AIRES'] },
	{ code: 'CL', keywords: ['CL', 'CHL', 'CHILE', 'SANTIAGO'] },
	{ code: 'CO', keywords: ['CO', 'COL', 'COLOMBIA', 'BOGOTA'] },
	{ code: 'PE', keywords: ['PE', 'PER', 'PERU', 'LIMA'] },
	{ code: 'NG', keywords: ['NG', 'NGA', 'NIGERIA', 'LAGOS'] }
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
	const shouldPrependRegionFlags = rule.prependRegionFlags ?? true;

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

	const nodeLines = selectedNodes.map((node) => {
		const renamed = applyRenameByName(node.raw, node.name.trim() || getLineName(node.raw), rule.renameMap);
		return shouldPrependRegionFlags ? applyRegionFlagByName(renamed) : renamed;
	});

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

	const renamedSubscriptionLines = subscriptionLines.map((line) => {
		const renamed = applyRenameByName(line, getLineName(line), rule.renameMap);
		return shouldPrependRegionFlags ? applyRegionFlagByName(renamed) : renamed;
	});
	const filteredSubscriptionLines = filterByAllowedTypes(renamedSubscriptionLines, allowedTypes);
	const content = normalizeContent([...nodeLines, ...filteredSubscriptionLines].join('\n'));
	return {
		content,
		lines: content ? content.split('\n').length : 0,
		warnings,
		errors
	};
}
