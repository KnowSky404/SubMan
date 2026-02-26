import type { AggregateRule, NodeItem, SubscriptionItem } from '$lib/models';

export type AggregateBuildResult = {
	content: string;
	lines: number;
	warnings: string[];
	errors: string[];
};

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function isExcluded(node: NodeItem, excludeTags: string[]): boolean {
	if (excludeTags.length === 0) {
		return false;
	}
	const tags = node.tags.map((tag) => normalize(tag.label)).concat(node.tags.map((tag) => normalize(tag.id)));
	return excludeTags.some((tag) => tags.includes(normalize(tag)));
}

function applyRenameByName(rawLine: string, originalName: string | null, renameMap: Record<string, string>): string {
	if (!originalName) {
		return rawLine;
	}

	const nextName = renameMap[originalName];
	if (!nextName) {
		return rawLine;
	}

	const hashIndex = rawLine.indexOf('#');
	if (hashIndex === -1) {
		return rawLine;
	}

	const base = rawLine.slice(0, hashIndex);
	return `${base}#${encodeURIComponent(nextName)}`;
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

	const known = new Set(['vless', 'vmess', 'trojan', 'ss', 'ssr', 'hysteria2', 'tuic']);
	if (known.has(scheme)) {
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

function decodeBase64(value: string): string | null {
	try {
		const compact = value.trim().replace(/\s+/g, '');
		const decoded = atob(compact);
		return decoded;
	} catch {
		return null;
	}
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
		applyRenameByName(node.raw, node.name ?? getLineName(node.raw), rule.renameMap)
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
		applyRenameByName(line, getLineName(line), rule.renameMap)
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
