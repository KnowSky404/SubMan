// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { presentWorkspaceOperation } from "$lib/workspace-operation-presenter";
import { rejectedWorkspaceOperation } from "$lib/workspace-operation-result";

const nodesPageSource = readFileSync(
	new URL("./+page.svelte", import.meta.url),
	"utf8",
);

test("nodes page uses the octicon tag asset instead of tag loop data", () => {
	expect(nodesPageSource).toContain("tag as tagIcon");
	expect(nodesPageSource).toContain("<Octicon icon={tagIcon}");
	expect(nodesPageSource).not.toContain("<Octicon icon={tag} ");
	expect(nodesPageSource).not.toContain("<Octicon icon={tag}>");
});

test("nodes page uses a unified github-style filter bar", () => {
	expect(nodesPageSource).toContain('class="gh-filter-bar"');
	expect(nodesPageSource).toContain('class="gh-filter-controls"');
	expect(nodesPageSource).toContain('class="gh-counter"');
	expect(nodesPageSource).toContain("gh-resource-list");
});

test("nodes filter bar separates search and status with creation in the page header", () => {
	expect(nodesPageSource).toContain("nodes-filter-tabs");
	expect(nodesPageSource).toContain("nodes-filter-search");
	expect(nodesPageSource).toContain("nodes-filter-status");
	expect(nodesPageSource).not.toContain("nodes-filter-action");
});

test("nodes page uses stable list row primitives", () => {
	expect(nodesPageSource).toContain("gh-row-main");
	expect(nodesPageSource).toContain("gh-row-title");
	expect(nodesPageSource).toContain("gh-row-actions");
	expect(nodesPageSource).toContain("gh-label");
});

test("single node add can derive the name from the raw URI", () => {
	expect(nodesPageSource).toContain("const raw = nodeRaw.trim();");
	expect(nodesPageSource).toContain("if (!raw) return;");
	expect(nodesPageSource).toContain(
		'nodeName.trim() || inferNodeNameFromRaw(raw, "Imported Node")',
	);
	expect(nodesPageSource).not.toContain(
		"if (!nodeName.trim() || !nodeRaw.trim()) return;",
	);
});

test("nodes page prevents duplicate raw URIs and subscription URLs", () => {
	expect(nodesPageSource).toContain(
		"findDuplicateNodeRaw($appState.nodes, raw)",
	);
	expect(nodesPageSource).toContain(
		"findDuplicateSubscriptionUrl(\n\t\t\t\t$appState.subscriptions,",
	);
	expect(nodesPageSource).toContain(
		'$t("A node with the same raw URI already exists: {name}"',
	);
	expect(nodesPageSource).toContain(
		'$t("A subscription with the same URL already exists: {name}"',
	);
});

test("nodes page makes saved resource names unique", () => {
	expect(nodesPageSource).toContain("function uniqueNodeName");
	expect(nodesPageSource).toContain("function uniqueSubscriptionName");
	expect(nodesPageSource).toContain("makeUniqueResourceName(");
	expect(nodesPageSource).toContain("formatResourceNameTimestamp()");
});

test("nodes page uses shared URI validation with a live warning", () => {
	expect(nodesPageSource).toContain(
		'import { validateProxyUri } from "$lib/proxy-protocol";',
	);
	expect(nodesPageSource).toContain("nodeUriValidation");
	expect(nodesPageSource).toContain('aria-live="polite"');
});

test("resource deletion interpolates the target name in confirmation and toast text", () => {
	expect(nodesPageSource).toContain(
		'message: $t("Delete {name} forever?", { name }),',
	);
	expect(nodesPageSource).toContain("successMessageParams: { name },");
});

test("resource editing opens a modal instead of expanding inline editors", () => {
	expect(nodesPageSource).toContain("let editingResource");
	expect(nodesPageSource).toContain("closeEditModal");
	expect(nodesPageSource).toContain("Edit Node");
	expect(nodesPageSource).toContain("Edit Subscription");
	expect(nodesPageSource).toContain("Close edit modal");
	expect(nodesPageSource).toContain("<Dialog");
	expect(nodesPageSource).not.toContain("Inline Editor for Node");
	expect(nodesPageSource).not.toContain("Inline Editor for Subscription");
	expect(nodesPageSource).not.toContain("expandedId");
});

test("resource editing preserves tag IDs for unchanged labels", () => {
	expect(nodesPageSource).toContain(
		"tags: reconcileTags(draft.tags, original.tags)",
	);
	expect(nodesPageSource).not.toContain("function parseTags(");
});

test("subscription preview shows safe actionable fetch diagnostics", () => {
	expect(nodesPageSource).toContain("presentSubscriptionFetchDiagnostic");
	expect(nodesPageSource).toContain("toSubscriptionFetchDiagnostic");
	expect(nodesPageSource).toContain("Retry subscription preview");
	expect(nodesPageSource).not.toContain(
		"err instanceof Error ? err.message : String(err)",
	);
});

for (const resource of ["nodes", "subscriptions"]) {
	for (const outcome of ["reset", "pending"]) {
		test(`batch ${resource} import stops after ${outcome} without clearing its draft`, async () => {
			const handleAddSource = nodesPageSource.slice(
				nodesPageSource.indexOf("async function handleAdd()"),
				nodesPageSource.indexOf("// Edit Logic"),
			);
			const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(
				handleAddSource,
			);
			let binding = {
				workspaceId: "gist:batch",
				baseline: { resetRevision: 0 },
			};
			let submitted = 0;
			const state = { nodes: [], subscriptions: [] };
			const upsert = () => {
				submitted += 1;
				if (outcome === "reset") {
					binding = { ...binding, baseline: { resetRevision: 2 } };
				}
				return {
					completion: Promise.resolve({
						status:
							outcome === "pending"
								? "local-durable-queued"
								: "remote-committed",
						durable: true,
						mutationId: "batch-mutation",
						state,
						revision: 1,
					}),
				};
			};
			const context = {
				addMode: "batch",
				activeTab: resource,
				batchContent:
					resource === "nodes"
						? "vless://first\nvless://second"
						: "https://first.test\nhttps://second.test",
				batchTags: "retained tag",
				$appState: state,
				isAddModalOpen: true,
				operationFeedback: null,
				getBrowserWorkspaceBinding: () => binding,
				extractSubscriptionNodeLines: (line) => [line],
				makeUniqueResourceName: (name) => name,
				inferNodeNameFromRaw: (raw) => raw,
				formatResourceNameTimestamp: () => "time",
				inferNodeTypeFromRaw: () => "vless",
				createId: () => "batch-id",
				nowIso: () => "2026-11-01T12:00:00.000Z",
				reconcileTags: () => [],
				upsertNode: upsert,
				upsertSubscription: upsert,
				presentWorkspaceOperation,
				rejectedWorkspaceOperation,
				$t: (key) => key,
				showToastNotify: () => undefined,
			};
			const originalDraft = context.batchContent;
			const handleAdd = new Function(
				"context",
				`with (context) { ${compiled}; return handleAdd; }`,
			)(context);
			await handleAdd();
			expect(submitted).toBe(1);
			expect(context.batchContent).toBe(originalDraft);
			expect(context.batchTags).toBe("retained tag");
			expect(context.isAddModalOpen).toBe(true);
		});
	}
}
