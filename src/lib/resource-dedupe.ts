import type { NodeItem, SubscriptionItem } from "./models";

function normalizeComparable(value: string): string {
	return value.trim();
}

export function formatResourceNameTimestamp(date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function makeUniqueResourceName(
	name: string,
	existingNames: string[],
	timestamp = formatResourceNameTimestamp(),
): string {
	const baseName = name.trim();
	const taken = new Set(existingNames.map(normalizeComparable));
	if (!taken.has(baseName)) {
		return baseName;
	}

	const timestampedName = `${baseName} ${timestamp}`;
	if (!taken.has(timestampedName)) {
		return timestampedName;
	}

	let counter = 2;
	let candidate = `${timestampedName} #${counter}`;
	while (taken.has(candidate)) {
		counter++;
		candidate = `${timestampedName} #${counter}`;
	}
	return candidate;
}

export function findDuplicateNodeRaw(
	nodes: NodeItem[],
	raw: string,
	excludeId?: string,
): NodeItem | null {
	const target = normalizeComparable(raw);
	return (
		nodes.find(
			(node) =>
				node.id !== excludeId && normalizeComparable(node.raw) === target,
		) ?? null
	);
}

export function findDuplicateSubscriptionUrl(
	subscriptions: SubscriptionItem[],
	url: string,
	excludeId?: string,
): SubscriptionItem | null {
	const target = normalizeComparable(url);
	return (
		subscriptions.find(
			(subscription) =>
				subscription.id !== excludeId &&
				normalizeComparable(subscription.url) === target,
		) ?? null
	);
}
