import type {
	AggregateRule,
	NodeItem,
	SortMode,
	SubscriptionItem,
} from "$lib/models";
import {
	loadSubscriptionContent,
	normalizeSubscriptionContent,
} from "$lib/subscription";
import { normalizeTagLabel, resolveLegacyExcludeTags } from "$lib/tags";

export type AggregateBuildResult = {
	content: string;
	lines: number;
	warnings: string[];
	errors: string[];
};

export type RegionFlagRule = {
	code: string;
	keywords: string[];
};

const KNOWN_PROXY_TYPES = new Set([
	"vless",
	"vmess",
	"trojan",
	"ss",
	"ssr",
	"hysteria2",
	"tuic",
	"anytls",
]);
const LEADING_FLAG_REGEX = /^(?:[\u{1F1E6}-\u{1F1FF}]{2})\s*/u;
const CUSTOM_REGION_RULE_LINE_REGEX = /^([A-Za-z]{2})\s*=\s*(.+)$/;
export const BUILT_IN_REGION_FLAG_RULES: RegionFlagRule[] = [
	{ code: "EU", keywords: ["EU", "EUR", "EUROPE", "欧洲"] },
	{ code: "HK", keywords: ["HK", "HKG", "HONG KONG", "HONGKONG", "香港"] },
	{ code: "MO", keywords: ["MO", "MAC", "MACAU", "澳门"] },
	{
		code: "TW",
		keywords: [
			"TW",
			"TWN",
			"TAIWAN",
			"TAIPEI",
			"KAOHSIUNG",
			"台湾",
			"台北",
			"高雄",
		],
	},
	{
		code: "JP",
		keywords: [
			"JP",
			"JPN",
			"JAPAN",
			"TOKYO",
			"OSAKA",
			"NAGOYA",
			"日本",
			"东京",
			"大阪",
			"名古屋",
		],
	},
	{ code: "SG", keywords: ["SG", "SGP", "SINGAPORE", "新加坡"] },
	{
		code: "KR",
		keywords: [
			"KR",
			"KOR",
			"KOREA",
			"SOUTH KOREA",
			"SEOUL",
			"BUSAN",
			"韩国",
			"首尔",
			"釜山",
		],
	},
	{
		code: "US",
		keywords: [
			"US",
			"USA",
			"UNITED STATES",
			"AMERICA",
			"NEW YORK",
			"LOS ANGELES",
			"SEATTLE",
			"SAN JOSE",
			"SAN FRANCISCO",
			"CHICAGO",
			"DALLAS",
			"MIAMI",
			"LAS VEGAS",
			"PHOENIX",
			"美国",
			"纽约",
			"洛杉矶",
			"西雅图",
			"圣何塞",
			"旧金山",
			"芝加哥",
			"达拉斯",
			"迈阿密",
			"拉斯维加斯",
			"凤凰城",
		],
	},
	{
		code: "CA",
		keywords: [
			"CA",
			"CAN",
			"CANADA",
			"TORONTO",
			"VANCOUVER",
			"MONTREAL",
			"加拿大",
			"多伦多",
			"温哥华",
			"蒙特利尔",
		],
	},
	{ code: "MX", keywords: ["MX", "MEX", "MEXICO", "MEXICO CITY", "墨西哥"] },
	{
		code: "GB",
		keywords: [
			"UK",
			"GB",
			"GBR",
			"UNITED KINGDOM",
			"BRITAIN",
			"ENGLAND",
			"LONDON",
			"MANCHESTER",
			"英国",
			"伦敦",
			"曼彻斯特",
		],
	},
	{
		code: "IE",
		keywords: ["IE", "IRL", "IRELAND", "DUBLIN", "爱尔兰", "都柏林"],
	},
	{
		code: "DE",
		keywords: [
			"DE",
			"DEU",
			"GERMANY",
			"FRANKFURT",
			"BERLIN",
			"MUNICH",
			"德国",
			"法兰克福",
			"柏林",
			"慕尼黑",
		],
	},
	{
		code: "FR",
		keywords: [
			"FR",
			"FRA",
			"FRANCE",
			"PARIS",
			"MARSEILLE",
			"法国",
			"巴黎",
			"马赛",
		],
	},
	{
		code: "NL",
		keywords: [
			"NL",
			"NLD",
			"NETHERLANDS",
			"AMSTERDAM",
			"ROTTERDAM",
			"荷兰",
			"阿姆斯特丹",
			"鹿特丹",
		],
	},
	{
		code: "BE",
		keywords: ["BE", "BEL", "BELGIUM", "BRUSSELS", "比利时", "布鲁塞尔"],
	},
	{ code: "LU", keywords: ["LU", "LUX", "LUXEMBOURG", "卢森堡"] },
	{
		code: "CH",
		keywords: [
			"CH",
			"CHE",
			"SWITZERLAND",
			"ZURICH",
			"GENEVA",
			"瑞士",
			"苏黎世",
			"日内瓦",
		],
	},
	{
		code: "AT",
		keywords: ["AT", "AUT", "AUSTRIA", "VIENNA", "奥地利", "维也纳"],
	},
	{
		code: "IT",
		keywords: ["IT", "ITA", "ITALY", "MILAN", "ROME", "意大利", "米兰", "罗马"],
	},
	{
		code: "ES",
		keywords: [
			"ES",
			"ESP",
			"SPAIN",
			"MADRID",
			"BARCELONA",
			"西班牙",
			"马德里",
			"巴塞罗那",
		],
	},
	{
		code: "PT",
		keywords: ["PT", "PRT", "PORTUGAL", "LISBON", "葡萄牙", "里斯本"],
	},
	{
		code: "SE",
		keywords: ["SE", "SWE", "SWEDEN", "STOCKHOLM", "瑞典", "斯德哥尔摩"],
	},
	{ code: "NO", keywords: ["NO", "NOR", "NORWAY", "OSLO", "挪威", "奥斯陆"] },
	{
		code: "FI",
		keywords: ["FI", "FIN", "FINLAND", "HELSINKI", "芬兰", "赫尔辛基"],
	},
	{
		code: "DK",
		keywords: ["DK", "DNK", "DENMARK", "COPENHAGEN", "丹麦", "哥本哈根"],
	},
	{
		code: "IS",
		keywords: ["IS", "ISL", "ICELAND", "REYKJAVIK", "冰岛", "雷克雅未克"],
	},
	{ code: "PL", keywords: ["PL", "POL", "POLAND", "WARSAW", "波兰", "华沙"] },
	{ code: "CZ", keywords: ["CZ", "CZE", "CZECH", "PRAGUE", "捷克", "布拉格"] },
	{ code: "SK", keywords: ["SK", "SVK", "SLOVAKIA", "BRATISLAVA", "斯洛伐克"] },
	{
		code: "HU",
		keywords: ["HU", "HUN", "HUNGARY", "BUDAPEST", "匈牙利", "布达佩斯"],
	},
	{
		code: "RO",
		keywords: ["RO", "ROU", "ROMANIA", "BUCHAREST", "罗马尼亚", "布加勒斯特"],
	},
	{
		code: "BG",
		keywords: ["BG", "BGR", "BULGARIA", "SOFIA", "保加利亚", "索菲亚"],
	},
	{ code: "GR", keywords: ["GR", "GRC", "GREECE", "ATHENS", "希腊", "雅典"] },
	{
		code: "HR",
		keywords: ["HR", "HRV", "CROATIA", "ZAGREB", "克罗地亚", "萨格勒布"],
	},
	{
		code: "SI",
		keywords: ["SI", "SVN", "SLOVENIA", "LJUBLJANA", "斯洛文尼亚"],
	},
	{
		code: "RS",
		keywords: ["RS", "SRB", "SERBIA", "BELGRADE", "塞尔维亚", "贝尔格莱德"],
	},
	{
		code: "UA",
		keywords: ["UA", "UKR", "UKRAINE", "KYIV", "KIEV", "乌克兰", "基辅"],
	},
	{
		code: "TR",
		keywords: [
			"TR",
			"TUR",
			"TURKEY",
			"TURKIYE",
			"ISTANBUL",
			"土耳其",
			"伊斯坦布尔",
		],
	},
	{
		code: "RU",
		keywords: [
			"RU",
			"RUS",
			"RUSSIA",
			"MOSCOW",
			"SAINT PETERSBURG",
			"俄罗斯",
			"莫斯科",
			"圣彼得堡",
		],
	},
	{
		code: "IL",
		keywords: ["IL", "ISR", "ISRAEL", "TEL AVIV", "以色列", "特拉维夫"],
	},
	{
		code: "AE",
		keywords: [
			"AE",
			"ARE",
			"UAE",
			"DUBAI",
			"ABU DHABI",
			"阿联酋",
			"迪拜",
			"阿布扎比",
		],
	},
	{
		code: "SA",
		keywords: [
			"SA",
			"SAU",
			"SAUDI",
			"RIYADH",
			"JEDDAH",
			"沙特",
			"利雅得",
			"吉达",
		],
	},
	{ code: "QA", keywords: ["QA", "QAT", "QATAR", "DOHA", "卡塔尔", "多哈"] },
	{ code: "EG", keywords: ["EG", "EGY", "EGYPT", "CAIRO", "埃及", "开罗"] },
	{
		code: "ZA",
		keywords: [
			"ZA",
			"ZAF",
			"SOUTH AFRICA",
			"JOHANNESBURG",
			"南非",
			"约翰内斯堡",
		],
	},
	{
		code: "IN",
		keywords: [
			"IN",
			"IND",
			"INDIA",
			"MUMBAI",
			"DELHI",
			"BANGALORE",
			"印度",
			"孟买",
			"德里",
			"班加罗尔",
		],
	},
	{
		code: "PK",
		keywords: ["PK", "PAK", "PAKISTAN", "KARACHI", "巴基斯坦", "卡拉奇"],
	},
	{
		code: "BD",
		keywords: ["BD", "BGD", "BANGLADESH", "DHAKA", "孟加拉国", "达卡"],
	},
	{
		code: "LK",
		keywords: ["LK", "LKA", "SRI LANKA", "COLOMBO", "斯里兰卡", "科伦坡"],
	},
	{
		code: "NP",
		keywords: ["NP", "NPL", "NEPAL", "KATHMANDU", "尼泊尔", "加德满都"],
	},
	{
		code: "KZ",
		keywords: ["KZ", "KAZ", "KAZAKHSTAN", "ALMATY", "哈萨克斯坦", "阿拉木图"],
	},
	{
		code: "UZ",
		keywords: ["UZ", "UZB", "UZBEKISTAN", "TASHKENT", "乌兹别克斯坦", "塔什干"],
	},
	{
		code: "TH",
		keywords: ["TH", "THA", "THAILAND", "BANGKOK", "泰国", "曼谷"],
	},
	{
		code: "VN",
		keywords: [
			"VN",
			"VNM",
			"VIETNAM",
			"HANOI",
			"HO CHI MINH",
			"SAIGON",
			"越南",
			"河内",
			"胡志明",
			"西贡",
		],
	},
	{
		code: "MY",
		keywords: ["MY", "MYS", "MALAYSIA", "KUALA LUMPUR", "马来西亚", "吉隆坡"],
	},
	{
		code: "ID",
		keywords: [
			"ID",
			"IDN",
			"INDONESIA",
			"JAKARTA",
			"印度尼西亚",
			"印尼",
			"雅加达",
		],
	},
	{
		code: "PH",
		keywords: ["PH", "PHL", "PHILIPPINES", "MANILA", "菲律宾", "马尼拉"],
	},
	{
		code: "KH",
		keywords: ["KH", "KHM", "CAMBODIA", "PHNOM PENH", "柬埔寨", "金边"],
	},
	{ code: "LA", keywords: ["LA", "LAO", "LAOS", "VIENTIANE", "老挝", "万象"] },
	{ code: "MM", keywords: ["MM", "MMR", "MYANMAR", "YANGON", "缅甸", "仰光"] },
	{
		code: "CN",
		keywords: [
			"CN",
			"CHN",
			"CHINA",
			"MAINLAND",
			"BEIJING",
			"SHANGHAI",
			"GUANGZHOU",
			"SHENZHEN",
			"HANGZHOU",
			"CHENGDU",
			"中国",
			"大陆",
			"北京",
			"上海",
			"广州",
			"深圳",
			"杭州",
			"成都",
		],
	},
	{
		code: "AU",
		keywords: [
			"AU",
			"AUS",
			"AUSTRALIA",
			"SYDNEY",
			"MELBOURNE",
			"BRISBANE",
			"PERTH",
			"澳大利亚",
			"悉尼",
			"墨尔本",
			"布里斯班",
			"珀斯",
		],
	},
	{
		code: "NZ",
		keywords: ["NZ", "NZL", "NEW ZEALAND", "AUCKLAND", "新西兰", "奥克兰"],
	},
	{
		code: "BR",
		keywords: ["BR", "BRA", "BRAZIL", "SAO PAULO", "巴西", "圣保罗"],
	},
	{
		code: "AR",
		keywords: [
			"AR",
			"ARG",
			"ARGENTINA",
			"BUENOS AIRES",
			"阿根廷",
			"布宜诺斯艾利斯",
		],
	},
	{
		code: "CL",
		keywords: ["CL", "CHL", "CHILE", "SANTIAGO", "智利", "圣地亚哥"],
	},
	{
		code: "CO",
		keywords: ["CO", "COL", "COLOMBIA", "BOGOTA", "哥伦比亚", "波哥大"],
	},
	{ code: "PE", keywords: ["PE", "PER", "PERU", "LIMA", "秘鲁", "利马"] },
	{
		code: "NG",
		keywords: ["NG", "NGA", "NIGERIA", "LAGOS", "尼日利亚", "拉各斯"],
	},
];

function normalizeRegionKeyword(value: string): string {
	return value
		.toUpperCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function normalizeRegionName(name: string): string {
	const normalized = normalizeRegionKeyword(name);
	return normalized ? ` ${normalized} ` : " ";
}

export function regionCodeToFlagEmoji(countryCode: string): string {
	if (!/^[A-Z]{2}$/.test(countryCode)) {
		return "";
	}

	return Array.from(countryCode)
		.map((char) => String.fromCodePoint(char.charCodeAt(0) + 127397))
		.join("");
}

export type CustomRegionFlagRuleIssue = {
	line: number;
	reason: "format" | "keywords";
	code?: string;
};

export function formatCustomRegionFlagRuleIssue(
	issue: CustomRegionFlagRuleIssue,
): string {
	switch (issue.reason) {
		case "keywords":
			return `Line ${issue.line}: add at least one keyword after ${issue.code ?? "CODE"} =`;
		default:
			return `Line ${issue.line}: use FLAG_CODE = keyword1, keyword2`;
	}
}

export function parseCustomRegionFlagRules(rawMap?: string): {
	rules: RegionFlagRule[];
	warnings: string[];
	issues: CustomRegionFlagRuleIssue[];
} {
	if (!rawMap?.trim()) {
		return { rules: [], warnings: [], issues: [] };
	}

	const issues: CustomRegionFlagRuleIssue[] = [];
	const rules: RegionFlagRule[] = [];

	for (const [index, rawLine] of rawMap.split(/\r?\n/).entries()) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const match = line.match(CUSTOM_REGION_RULE_LINE_REGEX);
		if (!match) {
			issues.push({ line: index + 1, reason: "format" });
			continue;
		}

		const code = match[1].toUpperCase();
		const keywords = match[2]
			.split(",")
			.map((keyword) => keyword.trim())
			.filter(Boolean);

		if (keywords.length === 0) {
			issues.push({ line: index + 1, reason: "keywords", code });
			continue;
		}

		rules.push({ code, keywords });
	}

	return {
		rules,
		warnings: issues.map(formatCustomRegionFlagRuleIssue),
		issues,
	};
}

export function normalizeCustomRegionFlagMap(rawMap?: string): {
	value: string;
	issues: CustomRegionFlagRuleIssue[];
} {
	const trimmed = rawMap?.trim() ?? "";
	if (!trimmed) {
		return { value: "", issues: [] };
	}

	const { rules, issues } = parseCustomRegionFlagRules(trimmed);
	if (issues.length > 0) {
		return { value: trimmed, issues };
	}

	const byCode = new Map<string, string[]>();
	const seenKeywords = new Map<string, Set<string>>();

	for (const rule of rules) {
		const existingKeywords = byCode.get(rule.code) ?? [];
		const keywordSet = seenKeywords.get(rule.code) ?? new Set<string>();

		for (const keyword of rule.keywords) {
			const normalizedKeyword = normalizeRegionKeyword(keyword);
			if (!normalizedKeyword || keywordSet.has(normalizedKeyword)) {
				continue;
			}
			keywordSet.add(normalizedKeyword);
			existingKeywords.push(keyword.trim());
		}

		byCode.set(rule.code, existingKeywords);
		seenKeywords.set(rule.code, keywordSet);
	}

	const value = Array.from(byCode.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([code, keywords]) => `${code} = ${keywords.join(", ")}`)
		.join("\n");

	return { value, issues: [] };
}

function inferRegionCodeFromName(
	name: string,
	rules: RegionFlagRule[],
): string | null {
	const normalizedName = normalizeRegionName(name);

	for (const rule of rules) {
		if (
			rule.keywords.some((keyword) => {
				const normalizedKeyword = normalizeRegionKeyword(keyword);
				return normalizedKeyword
					? normalizedName.includes(` ${normalizedKeyword} `)
					: false;
			})
		) {
			return rule.code;
		}
	}

	return null;
}

function prependRegionFlag(name: string, rules: RegionFlagRule[]): string {
	const trimmed = name.trim();
	if (!trimmed || LEADING_FLAG_REGEX.test(trimmed)) {
		return name;
	}

	const regionCode = inferRegionCodeFromName(trimmed, rules);
	if (!regionCode) {
		return name;
	}

	const flag = regionCodeToFlagEmoji(regionCode);
	return flag ? `${flag} ${trimmed}` : name;
}

function isExcluded(
	resource: Pick<NodeItem | SubscriptionItem, "tags">,
	excludeTags: string[],
): boolean {
	if (excludeTags.length === 0) {
		return false;
	}
	const tags = resource.tags.map((tag) => normalizeTagLabel(tag.label));
	return excludeTags.some((tag) => tags.includes(normalizeTagLabel(tag)));
}

function normalizeBase64(value: string): string | null {
	const compact = value.trim().replace(/\s+/g, "");
	if (!compact) {
		return null;
	}
	if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) {
		return null;
	}
	let normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
	const padding = normalized.length % 4;
	if (padding === 1) {
		return null;
	}
	if (padding === 2) {
		normalized += "==";
	} else if (padding === 3) {
		normalized += "=";
	}
	return normalized;
}

function decodeBase64Binary(value: string): string | null {
	try {
		const normalized = normalizeBase64(value);
		if (!normalized) {
			return null;
		}
		return atob(normalized);
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
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function replaceLineName(rawLine: string, nextName: string): string {
	if (!nextName) {
		return rawLine;
	}

	const hashIndex = rawLine.indexOf("#");
	if (hashIndex !== -1) {
		const base = rawLine.slice(0, hashIndex);
		return `${base}#${encodeURIComponent(nextName)}`;
	}

	if (rawLine.startsWith("vmess://")) {
		const payload = rawLine.slice("vmess://".length);
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

const REGEX_RULE_PATTERN = /^\/(.+)\/([gimuy]*)\s*=\s*(.+)$/;
const LITERAL_RULE_PATTERN = /^(.+)\s*=\s*(.+)$/;

function applyRenameRules(
	rawLine: string,
	originalName: string | null,
	rules: string[] = [],
	legacyMap: Record<string, string> = {},
): string {
	if (!originalName) {
		return rawLine;
	}

	let currentName = originalName;
	let changed = false;

	// 1. Try legacy map first (for backward compatibility)
	const legacyNext = legacyMap[originalName];
	if (legacyNext) {
		currentName = legacyNext;
		changed = true;
	}

	// 2. Apply new sequential rules (Regex or Literal)
	for (const rule of rules) {
		const regexMatch = rule.match(REGEX_RULE_PATTERN);
		if (regexMatch) {
			try {
				const re = new RegExp(regexMatch[1], regexMatch[2]);
				const nextName = currentName.replace(re, regexMatch[3]);
				if (nextName !== currentName) {
					currentName = nextName;
					changed = true;
				}
			} catch {
				// Invalid regex, skip
			}
			continue;
		}

		const literalMatch = rule.match(LITERAL_RULE_PATTERN);
		if (literalMatch) {
			const pattern = literalMatch[1].trim();
			const replacement = literalMatch[2].trim();
			// Match after trimming both sides to avoid invisible space issues
			if (currentName.trim() === pattern) {
				currentName = replacement;
				changed = true;
			}
		}
	}

	return changed ? replaceLineName(rawLine, currentName) : rawLine;
}

function applyRegionFlagByName(
	rawLine: string,
	rules: RegionFlagRule[],
): string {
	const originalName = getLineName(rawLine);
	if (!originalName) {
		return rawLine;
	}

	const nextName = prependRegionFlag(originalName, rules);
	if (nextName === originalName) {
		return rawLine;
	}

	return replaceLineName(rawLine, nextName);
}

function getLineName(rawLine: string): string | null {
	const hashIndex = rawLine.lastIndexOf("#");
	if (hashIndex > -1) {
		const name = rawLine.slice(hashIndex + 1);
		return name ? decodeURIComponent(name) : null;
	}

	if (rawLine.startsWith("vmess://")) {
		const payload = rawLine.slice("vmess://".length);
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

function inferTypeFromLine(line: string): NodeItem["type"] {
	const index = line.indexOf("://");
	if (index <= 0) {
		return "other";
	}

	const scheme = line.slice(0, index).toLowerCase();
	if (scheme === "hy2") {
		return "hysteria2";
	}

	if (KNOWN_PROXY_TYPES.has(scheme)) {
		return scheme as NodeItem["type"];
	}

	return "other";
}

function filterByAllowedTypes(
	lines: string[],
	allowedTypes: NodeItem["type"][] | null,
): string[] {
	if (!allowedTypes || allowedTypes.length === 0) {
		return lines;
	}

	return lines.filter((line) => allowedTypes.includes(inferTypeFromLine(line)));
}

function getFlagFromLine(line: string): string {
	const match = line.match(/^(?:[\u{1F1E6}-\u{1F1FF}]{2})/u);
	return match ? match[0] : "";
}

export function sortResultLines(
	lines: string[],
	mode: SortMode = "none",
	priorityStr: string = "",
): string[] {
	if (lines.length === 0) return [];

	const priorities = priorityStr
		.split("\n")
		.map((p) => p.trim())
		.filter(Boolean);
	const priorityGroups: string[][] = priorities.map(() => []);
	const remaining: string[] = [];

	for (const line of lines) {
		let matched = false;
		const displayName = getLineName(line) || "";
		for (let i = 0; i < priorities.length; i++) {
			const p = priorities[i];
			// Match against decoded display name or the raw line
			if (displayName.includes(p) || line.includes(p)) {
				priorityGroups[i].push(line);
				matched = true;
				break;
			}
		}
		if (!matched) {
			remaining.push(line);
		}
	}

	const sortFn = (a: string, b: string) => {
		if (mode === "none") return 0;
		if (mode === "name") {
			const nameA = getLineName(a) || "";
			const nameB = getLineName(b) || "";
			return nameA.localeCompare(nameB);
		}
		if (mode === "type") {
			return inferTypeFromLine(a).localeCompare(inferTypeFromLine(b));
		}
		if (mode === "region") {
			const flagA = getFlagFromLine(a);
			const flagB = getFlagFromLine(b);
			if (flagA !== flagB) return flagA.localeCompare(flagB);
			return (getLineName(a) || "").localeCompare(getLineName(b) || "");
		}
		return 0;
	};

	const result: string[] = [];
	for (const group of priorityGroups) {
		result.push(...group.sort(sortFn));
	}
	result.push(...remaining.sort(sortFn));

	return result;
}

export async function buildAggregateOutput(
	rule: AggregateRule,
	nodes: NodeItem[],
	subscriptions: SubscriptionItem[],
): Promise<AggregateBuildResult> {
	const warnings: string[] = [];
	const errors: string[] = [];
	const resolvedExclusions = resolveLegacyExcludeTags(
		rule.excludeTagIds,
		nodes,
		subscriptions,
	);
	const excludeTags = resolvedExclusions.values;
	for (const warning of resolvedExclusions.warnings) {
		warnings.push(`excluded-tag-needs-review:${warning.value}`);
	}
	const allowedTypes =
		rule.allowedTypes && rule.allowedTypes.length > 0
			? rule.allowedTypes
			: null;
	const shouldPrependRegionFlags = rule.prependRegionFlags ?? true;
	const { rules: customRegionFlagRules, warnings: customRegionWarnings } =
		parseCustomRegionFlagRules(rule.customRegionFlagMap);
	warnings.push(...customRegionWarnings);
	const activeRegionFlagRules = [
		...customRegionFlagRules,
		...BUILT_IN_REGION_FLAG_RULES,
	];

	const selectedNodes = nodes.filter(
		(node) =>
			node.enabled &&
			rule.nodeIds.includes(node.id) &&
			!isExcluded(node, excludeTags) &&
			(!allowedTypes || allowedTypes.includes(node.type)),
	);
	const selectedSubs = subscriptions.filter(
		(sub) =>
			sub.enabled &&
			rule.subscriptionIds.includes(sub.id) &&
			!isExcluded(sub, excludeTags),
	);

	const nodeLines = selectedNodes.map((node) => {
		const renamed = applyRenameRules(
			node.raw,
			node.name.trim() || getLineName(node.raw),
			rule.renameRules,
			rule.renameMap,
		);
		return shouldPrependRegionFlags
			? applyRegionFlagByName(renamed, activeRegionFlagRules)
			: renamed;
	});

	const subscriptionLines: string[] = [];
	for (const sub of selectedSubs) {
		try {
			const { content, warning, error } = await loadSubscriptionContent(
				sub.url,
			);
			if (warning) {
				warnings.push(
					`subscription:${sub.name}:${error?.code ?? "fetch-error"}: ${warning}`,
				);
				continue;
			}
			if (!content) {
				continue;
			}
			subscriptionLines.push(
				...normalizeSubscriptionContent(content).split("\n"),
			);
		} catch {
			warnings.push(
				`subscription:${sub.name}:network-or-cors: Subscription request failed due to network or browser CORS policy.`,
			);
		}
	}

	const renamedSubscriptionLines = subscriptionLines.map((line) => {
		const renamed = applyRenameRules(
			line,
			getLineName(line),
			rule.renameRules,
			rule.renameMap,
		);
		return shouldPrependRegionFlags
			? applyRegionFlagByName(renamed, activeRegionFlagRules)
			: renamed;
	});
	const filteredSubscriptionLines = filterByAllowedTypes(
		renamedSubscriptionLines,
		allowedTypes,
	);
	const combinedLines = [...nodeLines, ...filteredSubscriptionLines];
	const sortedLines = sortResultLines(
		combinedLines,
		rule.sortMode,
		rule.sortPriority,
	);
	const content = normalizeSubscriptionContent(sortedLines.join("\n"));
	return {
		content,
		lines: content ? content.split("\n").length : 0,
		warnings,
		errors,
	};
}
