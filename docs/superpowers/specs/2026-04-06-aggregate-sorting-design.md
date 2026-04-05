# Hybrid Sorting System for SubMan Aggregation

## Overview
This design implements a flexible sorting system for the proxy nodes generated in the `Aggregate` page. It allows users to group nodes by common criteria (Region, Protocol, Name) and define custom priorities via keywords.

## Architecture & Data Flow

### 1. Model Changes (`src/lib/models.ts`)
Add `SortMode` and update `AggregateRule`:
```typescript
export type SortMode = 'none' | 'name' | 'type' | 'region';

export type AggregateRule = {
    // ... existing fields
    sortMode?: SortMode;
    sortPriority?: string; // Multi-line keywords/regex
};
```

### 2. Logic Implementation (`src/lib/aggregate.ts`)
A new `sortResultLines` function will be used in `buildAggregateOutput` before the final `join('\n')`.

#### Sorting Logic:
1.  **Extract Priority**: Parse `sortPriority` into a list of regex/keywords.
2.  **Partition**:
    - For each priority keyword: Find all nodes matching it (not yet matched by previous keywords).
    - Collect remaining nodes into a "The Rest" group.
3.  **Sort Groups**:
    - Each priority group is internally sorted by the chosen `sortMode`.
    - "The Rest" group is internally sorted by the chosen `sortMode`.
4.  **Flatten**: Concatenate the groups in order.

#### Sort Modes:
- `none`: Use original discovery order.
- `name`: Sort alphabetically by the final display name (A-Z).
- `type`: Sort by protocol scheme (vless, vmess, etc.).
- `region`: Extract the flag emoji (or country code if inferred) and sort by region.

### 3. UI Implementation (`src/routes/aggregate/+page.svelte`)
- Add a **Sort Mode** dropdown.
- Add a **Priority Keywords** textarea.
- Update `loadRule`, `resetRuleForm`, and `saveRule` to handle these new fields.
- Update `buildPreview` to include the sorting logic.

## Testing Strategy
- **Unit Tests**: Add tests for the new `sortResultLines` function with various combinations of priority keywords and sort modes.
- **Integration Tests**: Verify that the `buildAggregateOutput` correctly applies sorting to mixed sources (nodes + subscriptions).
- **Manual Verification**: Use the "Preview Output" button in the UI to confirm the order matches expectations.

## Success Criteria
- Users can choose to group by region with one click.
- Users can force specific nodes to the top by typing keywords (e.g., "HK").
- Sorting is applied to both individual nodes and subscription-sourced nodes.
