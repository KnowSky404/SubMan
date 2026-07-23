import type { NodeItem, NodeTag, SubscriptionItem } from "$lib/models";
import { createId } from "$lib/utils/id";

export type LegacyExcludeTagWarning = {
	value: string;
	reason: "unresolved" | "ambiguous-id";
};

export type ResolvedExcludeTags = {
	values: string[];
	warnings: LegacyExcludeTagWarning[];
	migrations: { from: string; to: string }[];
};

export function normalizeTagLabel(value: string): string {
	return value.trim().toLowerCase();
}

export function parseTagLabels(value: string): string[] {
	const labels: string[] = [];
	const seen = new Set<string>();
	for (const entry of value.split(",")) {
		const label = entry.trim();
		const key = normalizeTagLabel(label);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		labels.push(label);
	}
	return labels;
}

export function reconcileTags(
	value: string,
	existing: readonly NodeTag[] = [],
	createTagId: () => string = () => createId("tag"),
): NodeTag[] {
	const existingByLabel = new Map<string, NodeTag>();
	for (const tag of existing) {
		const key = normalizeTagLabel(tag.label);
		if (key && !existingByLabel.has(key)) existingByLabel.set(key, tag);
	}

	return parseTagLabels(value).map((label) => {
		const prior = existingByLabel.get(normalizeTagLabel(label));
		return { id: prior?.id ?? createTagId(), label };
	});
}

export function resolveLegacyExcludeTags(
	values: readonly string[],
	nodes: readonly NodeItem[],
	subscriptions: readonly SubscriptionItem[],
): ResolvedExcludeTags {
	const labelsById = new Map<string, Map<string, string>>();
	const knownLabels = new Map<string, string>();
	for (const resource of [...nodes, ...subscriptions]) {
		for (const tag of resource.tags) {
			const labelKey = normalizeTagLabel(tag.label);
			if (!labelKey) continue;
			if (!knownLabels.has(labelKey))
				knownLabels.set(labelKey, tag.label.trim());
			const labels = labelsById.get(tag.id) ?? new Map<string, string>();
			if (!labels.has(labelKey)) labels.set(labelKey, tag.label.trim());
			labelsById.set(tag.id, labels);
		}
	}

	const resolved: string[] = [];
	const warnings: LegacyExcludeTagWarning[] = [];
	const migrations: { from: string; to: string }[] = [];
	const seen = new Set<string>();
	for (const entry of values) {
		const value = entry.trim();
		if (!value) continue;
		const valueKey = normalizeTagLabel(value);
		const knownLabel = knownLabels.get(valueKey);
		const idLabels = labelsById.get(value);
		let next = value;
		if (knownLabel) {
			next = knownLabel;
			if (
				idLabels &&
				[...idLabels.keys()].some((labelKey) => labelKey !== valueKey)
			) {
				warnings.push({ value, reason: "ambiguous-id" });
			}
		} else if (idLabels?.size === 1) {
			next = [...idLabels.values()][0] ?? value;
			if (next !== value) migrations.push({ from: value, to: next });
		} else if (idLabels && idLabels.size > 1) {
			warnings.push({ value, reason: "ambiguous-id" });
		} else {
			warnings.push({ value, reason: "unresolved" });
		}

		const key = normalizeTagLabel(next);
		if (seen.has(key)) continue;
		seen.add(key);
		resolved.push(next);
	}

	return { values: resolved, warnings, migrations };
}
