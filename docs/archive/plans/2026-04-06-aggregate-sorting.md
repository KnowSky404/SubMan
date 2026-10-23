# Aggregate Result Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a hybrid sorting system for aggregate rules that allows grouping by Region/Protocol and custom priority ordering.

**Architecture:** 
1. Update models to include `sortMode` and `sortPriority`.
2. Implement a robust sorting function in `src/lib/aggregate.ts` that handles partitioning by priority keywords and then sorting within those partitions.
3. Update the UI to allow configuring these new fields.
4. Add unit tests to verify the sorting logic.

**Tech Stack:** Svelte, TypeScript, Bun (for testing).

---

### Task 1: Update Models

**Files:**
- Modify: `src/lib/models.ts`

- [ ] **Step 1: Add SortMode type and update AggregateRule**

```typescript
export type SortMode = 'none' | 'name' | 'type' | 'region';

export type AggregateRule = {
	// ... existing fields
	sortMode?: SortMode;
	sortPriority?: string;
	// ...
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/models.ts
git commit -m "feat: add sortMode and sortPriority to AggregateRule model"
```

---

### Task 2: Implement Sorting Logic

**Files:**
- Modify: `src/lib/aggregate.ts`

- [ ] **Step 1: Add sorting helper functions**

Implement `sortResultLines` and its supporting logic.

```typescript
function getFlagFromLine(line: string): string {
	const match = line.match(/^(?:[\u{1F1E6}-\u{1F1FF}]{2})/u);
	return match ? match[0] : '';
}

export function sortResultLines(lines: string[], mode: SortMode = 'none', priorityStr: string = ''): string[] {
	if (lines.length === 0) return [];
	
	const priorities = priorityStr.split('\n').map(p => p.trim()).filter(Boolean);
	const priorityGroups: string[][] = priorities.map(() => []);
	const remaining: string[] = [];

	for (const line of lines) {
		let matched = false;
		for (let i = 0; i < priorities.length; i++) {
			const p = priorities[i];
			// Simple check if line contains priority keyword
			if (line.includes(p)) {
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
		if (mode === 'none') return 0;
		if (mode === 'name') {
			const nameA = getLineName(a) || '';
			const nameB = getLineName(b) || '';
			return nameA.localeCompare(nameB);
		}
		if (mode === 'type') {
			return inferTypeFromLine(a).localeCompare(inferTypeFromLine(b));
		}
		if (mode === 'region') {
			const flagA = getFlagFromLine(a);
			const flagB = getFlagFromLine(b);
			if (flagA !== flagB) return flagA.localeCompare(flagB);
			// Fallback to name sort within same region
			return (getLineName(a) || '').localeCompare(getLineName(b) || '');
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
```

- [ ] **Step 2: Integrate sorting into buildAggregateOutput**

Update `buildAggregateOutput` to use `sortResultLines`.

```typescript
// ... inside buildAggregateOutput
	const combinedLines = [...nodeLines, ...filteredSubscriptionLines];
	const sortedLines = sortResultLines(combinedLines, rule.sortMode, rule.sortPriority);
	const content = normalizeSubscriptionContent(sortedLines.join('\n'));
// ...
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/aggregate.ts
git commit -m "feat: implement hybrid sorting logic in buildAggregateOutput"
```

---

### Task 3: Add Unit Tests

**Files:**
- Create: `src/lib/aggregate.test.ts`

- [ ] **Step 1: Write tests for sortResultLines**

```typescript
import { describe, it, expect } from 'bun:test';
import { sortResultLines } from './aggregate';

describe('sortResultLines', () => {
    const lines = [
        'ss://abc#US-01',
        'vless://def#HK-01',
        'vmess://ghi#SG-01',
        'trojan://jkl#HK-02'
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

    it('should prioritize based on keywords', () => {
        const sorted = sortResultLines(lines, 'none', 'SG\nHK');
        expect(sorted[0]).toContain('SG-01');
        expect(sorted[1]).toContain('HK-01');
        expect(sorted[2]).toContain('HK-02');
        expect(sorted[3]).toContain('US-01');
    });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/lib/aggregate.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/aggregate.test.ts
git commit -m "test: add unit tests for aggregate sorting"
```

---

### Task 4: Update UI

**Files:**
- Modify: `src/routes/aggregate/+page.svelte`

- [ ] **Step 1: Add sortMode and sortPriority to component state**

```svelte
	let sortMode: string = "none";
	let sortPriority = "";
```

- [ ] **Step 2: Update loadRule, resetRuleForm, and saveRule**

Update these functions to handle the new fields.

- [ ] **Step 3: Add UI elements for sorting configuration**

Place the new controls in the "Rule Definition" box.

```svelte
<!-- Sorting Configuration -->
<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
    <div class="flex flex-col gap-1.5">
        <label class="text-sm font-semibold">{$t("Sort Mode")}</label>
        <select class="gh-select" bind:value={sortMode}>
            <option value="none">{$t("None (Original Order)")}</option>
            <option value="name">{$t("Alphabetical (A-Z)")}</option>
            <option value="type">{$t("By Protocol")}</option>
            <option value="region">{$t("By Region")}</option>
        </select>
    </div>
    <div class="flex flex-col gap-1.5">
        <label class="text-sm font-semibold">{$t("Priority Keywords (per line)")}</label>
        <textarea class="gh-input gh-textarea h-20 text-xs font-mono" placeholder="e.g.\nHK\nSG" bind:value={sortPriority}></textarea>
    </div>
</div>
```

- [ ] **Step 4: Update buildPreview to include sorting fields**

- [ ] **Step 5: Commit**

```bash
git add src/routes/aggregate/+page.svelte
git commit -m "feat: add sorting controls to aggregate UI"
```
