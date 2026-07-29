<script lang="ts">
import { fade, fly, slide } from "svelte/transition";
import { type DndEvent, dndzone } from "svelte-dnd-action";
import {
	BUILT_IN_REGION_FLAG_RULES,
	buildAggregateOutput,
	type RegionFlagRule,
	regionCodeToFlagEmoji,
} from "$lib/aggregate";
import GitHubSelect from "$lib/components/GitHubSelect.svelte";
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import type {
	AggregatePublishTarget,
	AggregateRule,
	AppState,
	ProxyType,
	SortMode,
} from "$lib/models";
import {
	alert,
	checkCircle,
	checklist,
	copy,
	database,
	eye,
	fileCode,
	globe,
	search,
	sliders,
	sync,
	trash,
	upload,
	workflow,
	x,
} from "$lib/octicons";
import {
	appState,
	removeAggregate,
	removePublishTarget,
	upsertAggregate,
	upsertPublishTarget,
	type WorkspaceActionHandle,
} from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { requestConfirm } from "$lib/stores/confirm";
import { showToast } from "$lib/stores/toast";
import {
	type LegacyExcludeTagWarning,
	normalizeTagLabel,
	parseTagLabels,
	resolveLegacyExcludeTags,
} from "$lib/tags";
import { cn } from "$lib/utils/cn";
import { createId } from "$lib/utils/id";
import { nowIso } from "$lib/utils/time";
import {
	commitQueuedBrowserWorkspaceMutation,
	reconcileBrowserWorkspace,
	submitBrowserWorkspaceMutation,
} from "$lib/workspace-browser-session-v2";
import {
	presentWorkspaceOperation,
	type WorkspaceOperationPresentation,
	type WorkspaceOperationPresentationOptions,
} from "$lib/workspace-operation-presenter";
import type { WorkspaceOperationResult } from "$lib/workspace-operation-result";
import {
	analyzeAggregateDelete,
	analyzePublishTargetDelete,
	findWorkspaceOutputConflicts,
} from "$lib/workspace-output";
import { getBrowserWorkspaceBinding } from "$lib/workspace-persistence-browser";
import { workspaceSyncStatus } from "$lib/workspace-sync-status";

let ruleName = "";
let selectedNodeIds: string[] = [];
let selectedSubscriptionIds: string[] = [];
let excludeTags = "";
let excludeTagMigrationWarnings: LegacyExcludeTagWarning[] = [];
let migratedExcludeTagLabels: string[] = [];
let excludeTagIdsMigrated = false;
let renameMap = "";
let customRegionFlagMap = "";
let allowedTypes: ProxyType[] = [];
let prependRegionFlags = true;
let sortMode: SortMode = "none";
let sortPriority = "";

// Menu State
let showRuleMenu = false;
let showNodesMenu = false;
let showSubsMenu = false;
let nodeSearchQuery = "";
let subSearchQuery = "";

// Region Browser State
let showBuiltInRegionMap = false;
let builtInRegionMapSearch = "";

type PreviewEntry = {
	id: string;
	line: string;
	protocol: string;
	name: string;
};

let previewEntries: PreviewEntry[] = [];
let previewLoading = false;
let previewGeneratedAt: string | null = null;
let previewSource: "draft" | "saved" = "draft";

let selectedTargetId = "";
let publishTargetName = "";
let publishTargetRuleId = "";
let publishTargetFile = "subman-aggregate.txt";
let publishUrl: string | null = null;
let publishing = false;
let editingRuleId = "";
let deletingRuleId = "";
let deletingTargetId = "";
const fieldIds = {
	ruleName: "aggregate-rule-name",
	excludeTags: "aggregate-exclude-tags",
	nodesMenu: "aggregate-source-nodes",
	subsMenu: "aggregate-source-subscriptions",
	nodeSearch: "aggregate-node-search",
	subSearch: "aggregate-sub-search",
	renameMap: "aggregate-rename-map",
	allowedTypes: "aggregate-allowed-types",
	sortMode: "aggregate-sort-mode",
	sortPriority: "aggregate-sort-priority",
	customRegionFlagMap: "aggregate-region-flag-map",
	prependRegionFlags: "aggregate-prepend-region-flags",
	builtInRegionMapSearch: "aggregate-region-map-search",
	targetSelect: "aggregate-target-select",
	targetName: "aggregate-target-name",
	targetRule: "aggregate-target-rule",
	targetFile: "aggregate-target-file",
};

const protocolOptions: { id: ProxyType; label: string }[] = [
	{ id: "vless", label: "VLESS" },
	{ id: "vmess", label: "VMess" },
	{ id: "trojan", label: "Trojan" },
	{ id: "ss", label: "Shadowsocks" },
	{ id: "ssr", label: "SSR" },
	{ id: "hysteria2", label: "Hysteria2" },
	{ id: "tuic", label: "TUIC" },
	{ id: "anytls", label: "AnyTLS" },
];

function toggleSelection<T extends string>(list: T[], id: T) {
	return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function selectAllNodes() {
	const visibleIds = filteredNodesInRule.map((n) => n.id);
	const allSelected = visibleIds.every((id) => selectedNodeIds.includes(id));
	if (allSelected) {
		selectedNodeIds = selectedNodeIds.filter((id) => !visibleIds.includes(id));
	} else {
		selectedNodeIds = Array.from(new Set([...selectedNodeIds, ...visibleIds]));
	}
}

function selectAllSubs() {
	const visibleIds = filteredSubsInRule.map((s) => s.id);
	const allSelected = visibleIds.every((id) =>
		selectedSubscriptionIds.includes(id),
	);
	if (allSelected) {
		selectedSubscriptionIds = selectedSubscriptionIds.filter(
			(id) => !visibleIds.includes(id),
		);
	} else {
		selectedSubscriptionIds = Array.from(
			new Set([...selectedSubscriptionIds, ...visibleIds]),
		);
	}
}

$: filteredNodesInRule = $appState.nodes.filter((n) =>
	n.name.toLowerCase().includes(nodeSearchQuery.toLowerCase()),
);
$: filteredSubsInRule = $appState.subscriptions.filter((s) =>
	s.name.toLowerCase().includes(subSearchQuery.toLowerCase()),
);
$: filteredRegionRules = BUILT_IN_REGION_FLAG_RULES.filter(
	(r) =>
		r.code.toLowerCase().includes(builtInRegionMapSearch.toLowerCase()) ||
		r.keywords.some((k) =>
			k.toLowerCase().includes(builtInRegionMapSearch.toLowerCase()),
		),
);

$: activeNodeCount = selectedNodeIds.filter((id) =>
	$appState.nodes.some((n) => n.id === id),
).length;
$: activeSubCount = selectedSubscriptionIds.filter((id) =>
	$appState.subscriptions.some((s) => s.id === id),
).length;
$: currentRulePickerLabel =
	$appState.aggregates.find((rule) => rule.id === editingRuleId)?.name ||
	$t("New Rule");
$: sortModeOptions = [
	{ value: "none", label: $t("None (Original Order)") },
	{ value: "name", label: $t("Alphabetical (A-Z)") },
	{ value: "type", label: $t("By Protocol") },
	{ value: "region", label: $t("By Region") },
];
$: targetSelectOptions = [
	{ value: "", label: `+ ${$t("New target")}` },
	...$appState.publishTargets.map((target) => ({
		value: target.id,
		label: target.name,
	})),
];
$: targetRuleOptions = $appState.aggregates.map((rule) => ({
	value: rule.id,
	label: rule.name,
}));
$: selectedSavedRule =
	$appState.aggregates.find((rule) => rule.id === editingRuleId) ?? null;
$: selectedSavedTarget =
	$appState.publishTargets.find((target) => target.id === selectedTargetId) ??
	null;
$: ruleDirty = selectedSavedRule
	? getSavedRuleSignature(selectedSavedRule) !== getRuleDraftSignature()
	: hasRuleDraft();
$: targetDirty = selectedSavedTarget
	? getSavedTargetSignature(selectedSavedTarget) !== getTargetDraftSignature()
	: hasTargetDraft();
$: outputConflicts = findWorkspaceOutputConflicts($appState);
$: selectedOutputConflict = outputConflicts.find(
	(conflict) => conflict.fileName === publishTargetFile.trim(),
);
$: workspaceIsManual = $workspaceSyncStatus.mode === "manual";
$: selectedTargetRule = $appState.aggregates.find(
	(rule) => rule.id === selectedSavedTarget?.ruleId,
);
$: selectedTargetNeedsRepublish = Boolean(
	selectedSavedTarget?.lastPublishedAt &&
		(selectedSavedTarget.updatedAt !== selectedSavedTarget.lastPublishedAt ||
			(selectedTargetRule?.updatedAt ?? "") >
				selectedSavedTarget.lastPublishedAt),
);
$: ordinaryPublishDisabled =
	publishing ||
	!isWorkspaceConnected ||
	!selectedTargetId ||
	ruleDirty ||
	targetDirty ||
	workspaceIsManual ||
	Boolean(selectedOutputConflict);

function getSavedRuleSignature(rule: AggregateRule): string {
	return JSON.stringify({
		name: rule.name,
		nodeIds: rule.nodeIds,
		subscriptionIds: rule.subscriptionIds,
		excludeTagIds: rule.excludeTagIds,
		renameRules: rule.renameRules ?? [],
		customRegionFlagMap: rule.customRegionFlagMap ?? "",
		allowedTypes: rule.allowedTypes,
		prependRegionFlags: rule.prependRegionFlags ?? true,
		sortMode: rule.sortMode ?? "none",
		sortPriority: rule.sortPriority ?? "",
	});
}

function getRuleDraftSignature(): string {
	return JSON.stringify({
		name: ruleName.trim(),
		nodeIds: selectedNodeIds,
		subscriptionIds: selectedSubscriptionIds,
		excludeTagIds: parseTagLabels(excludeTags),
		renameRules: renameMap
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean),
		customRegionFlagMap,
		allowedTypes,
		prependRegionFlags,
		sortMode,
		sortPriority,
	});
}

function hasRuleDraft(): boolean {
	return Boolean(
		ruleName.trim() ||
			selectedNodeIds.length ||
			selectedSubscriptionIds.length ||
			excludeTags.trim() ||
			renameMap.trim() ||
			customRegionFlagMap.trim() ||
			allowedTypes.length ||
			sortMode !== "none" ||
			sortPriority.trim(),
	);
}

function getSavedTargetSignature(target: AggregatePublishTarget): string {
	return JSON.stringify({
		name: target.name,
		ruleId: target.ruleId,
		fileName: target.fileName,
	});
}

function getTargetDraftSignature(): string {
	return JSON.stringify({
		name: publishTargetName.trim() || publishTargetFile.trim(),
		ruleId: publishTargetRuleId,
		fileName: publishTargetFile.trim(),
	});
}

function hasTargetDraft(): boolean {
	return Boolean(
		publishTargetName.trim() || publishTargetRuleId || publishTargetFile.trim(),
	);
}

function loadRule(rule: AggregateRule | undefined) {
	if (!rule) return;
	editingRuleId = rule.id;
	ruleName = rule.name;
	// Filter out any IDs that no longer exist in the global state
	selectedNodeIds = (rule.nodeIds || []).filter((id: string) =>
		$appState.nodes.some((n) => n.id === id),
	);
	selectedSubscriptionIds = (rule.subscriptionIds || []).filter((id: string) =>
		$appState.subscriptions.some((s) => s.id === id),
	);
	const resolvedExclusions = resolveLegacyExcludeTags(
		rule.excludeTagIds || [],
		$appState.nodes,
		$appState.subscriptions,
	);
	excludeTags = resolvedExclusions.values.join(", ");
	excludeTagMigrationWarnings = resolvedExclusions.warnings;
	migratedExcludeTagLabels = resolvedExclusions.migrations.map(
		(migration) => migration.to,
	);
	excludeTagIdsMigrated = migratedExcludeTagLabels.length > 0;
	renameMap = rule.renameRules
		? rule.renameRules.join("\n")
		: Object.entries(rule.renameMap || {})
				.map(([k, v]) => `${k}=${v}`)
				.join("\n");
	customRegionFlagMap = rule.customRegionFlagMap || "";
	allowedTypes = rule.allowedTypes || [];
	prependRegionFlags = rule.prependRegionFlags ?? true;
	sortMode = rule.sortMode || "none";
	sortPriority = rule.sortPriority || "";
}

$: publishedTargetCount = $appState.publishTargets.filter(
	(target) => target.lastPublishedUrl,
).length;
$: isWorkspaceConnected = Boolean($authState.token && $appState.activeGistId);
$: previewGeneratedText = previewGeneratedAt
	? new Intl.DateTimeFormat(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		}).format(new Date(previewGeneratedAt))
	: null;

function resetRuleForm() {
	editingRuleId = "";
	ruleName = "";
	selectedNodeIds = [];
	selectedSubscriptionIds = [];
	excludeTags = "";
	excludeTagMigrationWarnings = [];
	migratedExcludeTagLabels = [];
	excludeTagIdsMigrated = false;
	renameMap = "";
	customRegionFlagMap = "";
	allowedTypes = [];
	prependRegionFlags = true;
	sortMode = "none";
	sortPriority = "";
	previewEntries = [];
	previewGeneratedAt = null;
}

function loadPublishTarget(target: AggregatePublishTarget) {
	selectedTargetId = target.id;
	publishTargetName = target.name;
	publishTargetRuleId = target.ruleId;
	publishTargetFile = target.fileName;
	publishUrl = target.lastPublishedUrl;
}

function resetTargetForm() {
	selectedTargetId = "";
	publishTargetName = "";
	publishTargetRuleId = $appState.aggregates[0]?.id || "";
	publishTargetFile = "aggregate.txt";
	publishUrl = null;
}

type PendingWorkspaceAction = {
	handle: WorkspaceActionHandle;
	kind: "aggregate.upsert" | "publish-target.upsert";
	payload: unknown;
	ruleId?: string;
	targetId?: string;
	targetBeforeSave?: AggregatePublishTarget | null;
	previousFileCleanup?: "keep" | "delete-if-unreferenced";
};

function showWorkspaceResult(
	result: WorkspaceOperationResult,
	options: WorkspaceOperationPresentationOptions = {},
): WorkspaceOperationPresentation {
	const presentation = presentWorkspaceOperation(result, options);
	showToast(
		$t(presentation.messageKey, presentation.messageParams),
		presentation.tone,
	);
	return presentation;
}

async function commitPendingAction(
	action: PendingWorkspaceAction,
	allowManual: boolean,
): Promise<WorkspaceOperationResult> {
	const token = $authState.token;
	if (!token) throw new Error("Missing GitHub token");
	const result = await action.handle.completion;
	if (result.status === "local-durable-queued") {
		return commitQueuedBrowserWorkspaceMutation({
			token,
			mutationId: result.mutationId,
		});
	}
	if (
		result.status === "local-durable" &&
		result.mode === "manual" &&
		allowManual
	) {
		return submitBrowserWorkspaceMutation(
			{ token, kind: action.kind, payload: action.payload },
			{ allowManual: true },
		);
	}
	return result;
}

async function awaitPendingLocalAction(
	action: PendingWorkspaceAction,
): Promise<WorkspaceOperationResult> {
	return action.handle.completion;
}

function finalizePendingAction(action: PendingWorkspaceAction): void {
	if (action.ruleId) {
		editingRuleId = action.ruleId;
		if (!publishTargetRuleId) publishTargetRuleId = action.ruleId;
	}
	if (action.targetId) selectedTargetId = action.targetId;
}

function createRuleDraft(id: string): AggregateRule {
	const finalNodeIds = selectedNodeIds.filter((nodeId) =>
		$appState.nodes.some((node) => node.id === nodeId),
	);
	const finalSubIds = selectedSubscriptionIds.filter((subscriptionId) =>
		$appState.subscriptions.some(
			(subscription) => subscription.id === subscriptionId,
		),
	);
	return {
		id,
		name: ruleName.trim(),
		nodeIds: finalNodeIds,
		subscriptionIds: finalSubIds,
		excludeTagIds: parseTagLabels(excludeTags),
		renameMap: {},
		renameRules: renameMap
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean),
		customRegionFlagMap,
		allowedTypes,
		prependRegionFlags,
		sortMode,
		sortPriority,
		updatedAt: nowIso(),
	};
}

function saveRuleDraft(): PendingWorkspaceAction | null {
	if (!ruleName.trim()) return null;
	const id = editingRuleId || createId("agg");
	const rule = createRuleDraft(id);
	const handle = upsertAggregate(rule);
	return {
		handle,
		kind: "aggregate.upsert",
		payload: { aggregate: rule },
		ruleId: id,
	};
}

async function saveRule(): Promise<void> {
	const action = saveRuleDraft();
	if (!action) return;
	const result = await awaitPendingLocalAction(action);
	const presentation = showWorkspaceResult(result, {
		localDurableMessageKey: "Rule saved",
		remoteCommittedMessageKey: "Rule saved",
	});
	if (presentation.finalizeDraft) finalizePendingAction(action);
}

async function choosePreviousFileCleanup(
	existing: AggregatePublishTarget | null,
	nextFileName: string,
): Promise<"keep" | "delete-if-unreferenced" | null> {
	if (!existing || existing.fileName === nextFileName) return "keep";
	const proceed = await requestConfirm({
		title: $t("Change output file"),
		message: $t(
			'Publishing to "{next}" will create a new stable link. Current published file: {current}. Existing clients using the old link must be updated manually.',
			{ next: nextFileName, current: existing.fileName },
		),
		confirmText: $t("Continue"),
	});
	if (!proceed) return null;
	const cleanup = await requestConfirm({
		title: $t("Previous output file"),
		message: $t(
			"Delete the previous output file if no other target or export profile references it?",
		),
		confirmText: $t("Delete old file"),
		cancelText: $t("Keep old file"),
		danger: true,
	});
	return cleanup ? "delete-if-unreferenced" : "keep";
}

async function saveTargetDraft(): Promise<PendingWorkspaceAction | null> {
	const fileName = publishTargetFile.trim();
	if (!fileName || !publishTargetRuleId) return null;
	const id = selectedTargetId || createId("pub");
	const existing =
		$appState.publishTargets.find((target) => target.id === id) ?? null;
	const previousFileCleanup = await choosePreviousFileCleanup(
		existing,
		fileName,
	);
	if (previousFileCleanup === null) return null;
	const target: AggregatePublishTarget = {
		...(existing ?? {
			lastPublishedAt: null,
			lastPublishedUrl: null,
			lastPublishTransitionAt: null,
			lastPublishTransitionFromFileName: null,
			lastPublishTransitionToFileName: null,
			lastPublishTransitionOutcome: null,
		}),
		id,
		name: publishTargetName.trim() || fileName,
		ruleId: publishTargetRuleId,
		fileName,
		description: existing?.description ?? "",
		isPublic: existing?.isPublic ?? false,
		updatedAt: nowIso(),
	};
	const payload = { target, previousFileCleanup };
	const handle = upsertPublishTarget(target, { previousFileCleanup });
	return {
		handle,
		kind: "publish-target.upsert",
		payload,
		targetId: id,
		targetBeforeSave: existing,
		previousFileCleanup,
	};
}

async function saveTarget(): Promise<void> {
	const action = await saveTargetDraft();
	if (!action) return;
	if (
		workspaceIsManual &&
		action.previousFileCleanup === "delete-if-unreferenced"
	) {
		const localSnapshot = $appState;
		try {
			const localResult = await awaitPendingLocalAction(action);
			const localPresentation = presentWorkspaceOperation(localResult);
			if (!localPresentation.finalizeDraft) {
				showWorkspaceResult(localResult);
				return;
			}
			finalizePendingAction(action);
			const reconcileResult = await pushSelectedManualConfiguration(
				manualStateBeforeTargetAction(localSnapshot, action),
			);
			if (!presentWorkspaceOperation(reconcileResult).remoteCommitted) {
				showWorkspaceResult(reconcileResult);
				return;
			}
			const result = await commitPendingAction(action, true);
			showWorkspaceResult(result);
		} catch (error) {
			showToast(
				$t("Workspace change was not saved: {error}", {
					error: error instanceof Error ? error.message : String(error),
				}),
				"error",
			);
		}
		return;
	}
	const result = await awaitPendingLocalAction(action);
	const presentation = showWorkspaceResult(result, {
		localDurableMessageKey: "Target saved",
		remoteCommittedMessageKey: "Target saved",
	});
	if (presentation.finalizeDraft) finalizePendingAction(action);
}

async function submitManualDelete(
	kind: "aggregate.delete" | "publish-target.delete",
	payload: unknown,
): Promise<WorkspaceOperationResult | null> {
	const token = $authState.token;
	if (!token) return null;
	try {
		const reconcileResult = await pushSelectedManualConfiguration($appState);
		if (!presentWorkspaceOperation(reconcileResult).remoteCommitted) {
			return reconcileResult;
		}
		return submitBrowserWorkspaceMutation(
			{ token, kind, payload },
			{ allowManual: true },
		);
	} catch (error) {
		showToast(
			$t("Workspace change was not saved: {error}", {
				error: error instanceof Error ? error.message : String(error),
			}),
			"error",
		);
		return null;
	}
}

async function deleteTarget(): Promise<void> {
	if (!selectedTargetId || deletingTargetId) return;
	const targetId = selectedTargetId;
	const impact = analyzePublishTargetDelete($appState, targetId);
	const ownerSummary = impact.otherOwners.length
		? impact.otherOwners
				.map((owner) => `${owner.kind}: ${owner.name}`)
				.join(", ")
		: $t("None");
	const confirmed = await requestConfirm({
		title: $t("Delete Target"),
		message: $t(
			"Delete target {name}?\nRule: {rule}\nOutput: {file}\nPublished: {published}\nOther owners: {owners}",
			{
				name: impact.target.name,
				rule: impact.ruleName,
				file: impact.target.fileName,
				published: impact.target.lastPublishedAt ? $t("Yes") : $t("No"),
				owners: ownerSummary,
			},
		),
		confirmText: $t("Continue"),
		danger: true,
	});
	if (!confirmed) return;
	let cleanupUnreferencedOutputs = false;
	if (impact.canDeleteOutput && isWorkspaceConnected) {
		cleanupUnreferencedOutputs = await requestConfirm({
			title: $t("Output file"),
			message: $t("Also delete unreferenced output file {file}?", {
				file: impact.target.fileName,
			}),
			confirmText: $t("Delete target and file"),
			cancelText: $t("Keep output file"),
			danger: true,
		});
	}
	deletingTargetId = targetId;
	try {
		if (cleanupUnreferencedOutputs && workspaceIsManual) {
			const result = await submitManualDelete("publish-target.delete", {
				id: targetId,
				cleanupUnreferencedOutputs,
			});
			if (!result) return;
			const presentation = showWorkspaceResult(result, {
				remoteCommittedMessageKey: "Publish target deleted.",
			});
			if (!presentation.remoteCommitted) return;
			resetTargetForm();
			return;
		}
		const handle = removePublishTarget(selectedTargetId, {
			cleanupUnreferencedOutputs,
		});
		const result = await handle.completion;
		const presentation = showWorkspaceResult(result, {
			localDurableMessageKey: "Publish target deleted.",
			remoteCommittedMessageKey: "Publish target deleted.",
		});
		if (!presentation.finalizeDraft) return;
		resetTargetForm();
	} finally {
		deletingTargetId = "";
	}
}

async function deleteRule(): Promise<void> {
	if (!editingRuleId || deletingRuleId) return;
	const ruleId = editingRuleId;
	const impact = analyzeAggregateDelete($appState, ruleId);
	const fileList = impact.fileNames.length
		? impact.fileNames.join(", ")
		: $t("None");
	const confirmed = await requestConfirm({
		title: $t("Delete current rule"),
		message: $t(
			"Delete rule {name}?\nPublish targets: {targets}\nClient exports: {exports}\nOutput files: {files}",
			{
				name: impact.aggregate.name,
				targets: impact.targets.length,
				exports: impact.exports.length,
				files: fileList,
			},
		),
		confirmText: $t("Continue"),
		danger: true,
	});
	if (!confirmed) return;
	const resetBoundTarget =
		impact.targets.some((target) => target.id === selectedTargetId) ||
		publishTargetRuleId === editingRuleId;
	let cleanupUnreferencedOutputs = false;
	if (impact.fileNames.length > 0 && isWorkspaceConnected) {
		cleanupUnreferencedOutputs = await requestConfirm({
			title: $t("Output files"),
			message: $t("Also delete unreferenced published output files?\n{files}", {
				files: fileList,
			}),
			confirmText: $t("Delete rule and files"),
			cancelText: $t("Keep output files"),
			danger: true,
		});
	}
	deletingRuleId = ruleId;
	try {
		if (cleanupUnreferencedOutputs && workspaceIsManual) {
			const result = await submitManualDelete("aggregate.delete", {
				id: ruleId,
				cleanupUnreferencedOutputs,
			});
			if (!result) return;
			const presentation = showWorkspaceResult(result, {
				remoteCommittedMessageKey: "Rule deleted.",
			});
			if (!presentation.remoteCommitted) return;
			resetRuleForm();
			if (resetBoundTarget) resetTargetForm();
			return;
		}
		const handle = removeAggregate(editingRuleId, {
			cleanupUnreferencedOutputs,
		});
		const result = await handle.completion;
		const presentation = showWorkspaceResult(result, {
			localDurableMessageKey: "Rule deleted.",
			remoteCommittedMessageKey: "Rule deleted.",
		});
		if (!presentation.finalizeDraft) return;
		resetRuleForm();
		if (resetBoundTarget) resetTargetForm();
	} finally {
		deletingRuleId = "";
	}
}

function manualStateBeforeTargetAction(
	localSnapshot: AppState,
	action: PendingWorkspaceAction,
): AppState {
	if (!action.targetId) return localSnapshot;
	const targetBeforeSave = action.targetBeforeSave;
	return {
		...localSnapshot,
		publishTargets: targetBeforeSave
			? localSnapshot.publishTargets.map((target) =>
					target.id === action.targetId ? targetBeforeSave : target,
				)
			: localSnapshot.publishTargets.filter(
					(target) => target.id !== action.targetId,
				),
	};
}

async function pushSelectedManualConfiguration(
	resolvedState: AppState = $appState,
): Promise<WorkspaceOperationResult> {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	const binding = getBrowserWorkspaceBinding();
	if (!token || !gistId || !binding?.baseline) {
		throw new Error($t("Missing workspace authorization."));
	}
	return reconcileBrowserWorkspace({
		token,
		gistId,
		baseline: binding.baseline,
		resolvedState,
		syncMode: "manual",
	});
}

async function publishSaved(allowManual = false): Promise<void> {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	if (!token || !gistId || !selectedTargetId) return;

	publishing = true;
	try {
		const target = $appState.publishTargets.find(
			(item) => item.id === selectedTargetId,
		);
		const rule = $appState.aggregates.find(
			(item) => item.id === target?.ruleId,
		);
		if (!target || !rule) throw new Error("Publish target not found");
		const output = await buildAggregateOutput(
			rule,
			$appState.nodes,
			$appState.subscriptions,
		);
		if (output.errors.length > 0) {
			throw new Error(output.errors[0] ?? "Publish failed");
		}
		const result = await submitBrowserWorkspaceMutation(
			{
				token,
				kind: "aggregate.publish",
				payload: {
					targetId: target.id,
					output: { fileName: target.fileName, content: output.content },
				},
			},
			{ allowManual },
		);
		publishUrl =
			$appState.publishTargets.find((target) => target.id === selectedTargetId)
				?.lastPublishedUrl ?? null;
		showWorkspaceResult(result, {
			remoteCommittedMessageKey: "Published successfully to GitHub Gist",
			rejectedMessageKey: "Publish failed: {error}",
		});
	} catch (err) {
		showToast(
			$t("Publish failed: {error}", {
				error: err instanceof Error ? err.message : String(err),
			}),
			"error",
		);
	} finally {
		publishing = false;
	}
}

async function publish(): Promise<void> {
	if (ruleDirty || targetDirty) {
		showToast($t("Save target changes before publishing."), "error");
		return;
	}
	await publishSaved(false);
}

async function saveAndPublish(): Promise<void> {
	if (!isWorkspaceConnected) return;
	publishing = true;
	try {
		let targetAction: PendingWorkspaceAction | null = null;
		if (ruleDirty) {
			const ruleAction = saveRuleDraft();
			if (!ruleAction) throw new Error($t("Rule name is required."));
			const result = workspaceIsManual
				? await awaitPendingLocalAction(ruleAction)
				: await commitPendingAction(ruleAction, false);
			const presentation = presentWorkspaceOperation(result);
			if (presentation.finalizeDraft) finalizePendingAction(ruleAction);
			if (!presentation.finalizeDraft) {
				showWorkspaceResult(result);
				return;
			}
			if (!workspaceIsManual && !presentation.remoteCommitted) {
				showWorkspaceResult(result);
				return;
			}
		}
		if (targetDirty || !selectedTargetId) {
			targetAction = await saveTargetDraft();
			if (!targetAction) throw new Error($t("Failed to save publish target."));
			const result = workspaceIsManual
				? await awaitPendingLocalAction(targetAction)
				: await commitPendingAction(targetAction, false);
			const presentation = presentWorkspaceOperation(result);
			if (presentation.finalizeDraft) finalizePendingAction(targetAction);
			if (!presentation.finalizeDraft) {
				showWorkspaceResult(result);
				return;
			}
			if (!workspaceIsManual && !presentation.remoteCommitted) {
				showWorkspaceResult(result);
				return;
			}
		}
		if (workspaceIsManual) {
			const localSnapshot = $appState;
			const manualReconcileState = targetAction
				? manualStateBeforeTargetAction(localSnapshot, targetAction)
				: localSnapshot;
			const reconcileResult =
				await pushSelectedManualConfiguration(manualReconcileState);
			if (!presentWorkspaceOperation(reconcileResult).remoteCommitted) {
				showWorkspaceResult(reconcileResult);
				return;
			}
			if (targetAction) {
				const targetResult = await commitPendingAction(targetAction, true);
				if (!presentWorkspaceOperation(targetResult).remoteCommitted) {
					showWorkspaceResult(targetResult);
					return;
				}
			}
		}
		publishing = false;
		await publishSaved(workspaceIsManual);
	} catch (error) {
		showToast(
			$t("Publish failed: {error}", {
				error: error instanceof Error ? error.message : String(error),
			}),
			"error",
		);
	} finally {
		publishing = false;
	}
}

async function buildPreview() {
	if (!selectedNodeIds.length && !selectedSubscriptionIds.length) {
		showToast($t("Select nodes or subs."), "error");
		return;
	}
	previewLoading = true;
	try {
		const renameRules = renameMap
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		const rule: AggregateRule = {
			id: "preview",
			name: ruleName || "Preview",
			nodeIds: selectedNodeIds,
			subscriptionIds: selectedSubscriptionIds,
			excludeTagIds: parseTagLabels(excludeTags),
			renameMap: {},
			renameRules,
			customRegionFlagMap,
			allowedTypes,
			prependRegionFlags,
			sortMode,
			sortPriority,
			updatedAt: nowIso(),
		};
		const result = await buildAggregateOutput(
			rule,
			$appState.nodes,
			$appState.subscriptions,
		);
		const lines = result.content
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		previewEntries = lines.map((line, idx) => {
			const schemeIdx = line.indexOf("://");
			const protocol = schemeIdx > 0 ? line.slice(0, schemeIdx) : "unknown";
			let name = "unnamed";
			const hashIdx = line.lastIndexOf("#");
			if (hashIdx > schemeIdx) {
				try {
					name = decodeURIComponent(line.slice(hashIdx + 1));
				} catch {
					name = line.slice(hashIdx + 1);
				}
			}
			return { id: `p-${idx}-${line}`, line, protocol, name };
		});
		if (previewEntries.length === 0)
			showToast($t("No nodes matched criteria"), "info");
		else {
			previewGeneratedAt = new Date().toISOString();
			previewSource = ruleDirty ? "draft" : "saved";
		}
	} catch (err) {
		showToast($t("Preview failed"), "error");
	} finally {
		previewLoading = false;
	}
}

async function copyLine(line: string) {
	try {
		await navigator.clipboard.writeText(line);
		showToast($t("Copied to clipboard"), "success");
	} catch {
		showToast($t("Copy failed"), "error");
	}
}

function insertRegionRule(rule: RegionFlagRule) {
	const line = `${rule.code} = ${rule.keywords.join(", ")}`;
	customRegionFlagMap = customRegionFlagMap.trim()
		? `${customRegionFlagMap}\n${line}`
		: line;
	showBuiltInRegionMap = false;
}

function handlePreviewDndConsider(e: CustomEvent<DndEvent<PreviewEntry>>) {
	previewEntries = e.detail.items;
}

function handlePreviewDndFinalize(e: CustomEvent<DndEvent<PreviewEntry>>) {
	previewEntries = e.detail.items;
	sortPriority = previewEntries.map((entry) => entry.name).join("\n");
}

function handleExcludeTagsInput() {
	const currentLabels = new Set(
		parseTagLabels(excludeTags).map(normalizeTagLabel),
	);
	excludeTagMigrationWarnings = excludeTagMigrationWarnings.filter((warning) =>
		currentLabels.has(normalizeTagLabel(warning.value)),
	);
	migratedExcludeTagLabels = migratedExcludeTagLabels.filter((label) =>
		currentLabels.has(normalizeTagLabel(label)),
	);
	excludeTagIdsMigrated = migratedExcludeTagLabels.length > 0;
}
</script>

<div class="gh-page">
	<header class="gh-page-header">
		<div class="gh-page-heading">
			<h1 class="gh-page-title">{$t("Aggregate")}</h1>
			<p class="gh-page-subtitle">
				{$t("Build source selection, filtering, rename, sorting, preview, and publish rules.")}
			</p>
			<div class="gh-page-meta">
				<span class="gh-page-meta-item">{$t("{count} rules", { count: $appState.aggregates.length })}</span>
				<span class="gh-page-meta-item">{$t("{count} targets", { count: $appState.publishTargets.length })}</span>
				<span class={cn("gh-page-meta-item", isWorkspaceConnected && "badge-success")}>
					{isWorkspaceConnected ? $t("Workspace connected") : $t("Local-only")}
				</span>
			</div>
		</div>
		<div class="gh-page-actions">
			<button type="button" class="gh-btn" on:click={buildPreview} disabled={previewLoading}>
				{#if previewLoading}<Octicon icon={sync} className="h-4 w-4 animate-spin" />{:else}<Octicon icon={eye} className="h-4 w-4" />{/if}
				{$t("Preview")}
			</button>
			<button type="button" class="gh-btn gh-btn-primary" on:click={saveRule}>
				<Octicon icon={checkCircle} className="h-4 w-4" />
				{$t("Save Rule")}
			</button>
		</div>
</header>

{#if outputConflicts.length > 0}
	<div class="gh-alert gh-alert-warning mb-4 flex-col items-start">
		<strong>{$t("Output filename conflicts need repair")}</strong>
		{#each outputConflicts as conflict}
			<span class="text-xs">
				<code>{conflict.fileName}</code>: {conflict.owners.map((owner) => `${owner.kind}: ${owner.name}`).join(", ")}
			</span>
		{/each}
	</div>
{/if}

	<div class="gh-layout-sidebar lg:grid-cols-[minmax(0,1fr)_340px]">
		<!-- Main Rule Editor -->
		<div class="gh-layout-main">
			<div class="gh-box shadow-sm !overflow-visible">
				<div class="gh-box-header">
					<div class="flex min-w-0 items-center gap-2">
						<Octicon icon={sliders} className="h-4 w-4" />
						<span>{$t("Rule Definition")}</span>
						<span class="gh-counter">{$appState.aggregates.length}</span>
					</div>
					<div class="gh-toolbar-group min-w-0 relative">
						<button
							type="button"
							class="gh-select gh-select-sm flex w-48 items-center justify-between text-left"
							on:click={() => { showRuleMenu = !showRuleMenu; showNodesMenu = false; showSubsMenu = false; }}
							aria-haspopup="menu"
							aria-expanded={showRuleMenu}
						>
							<span class="min-w-0 truncate">{currentRulePickerLabel}</span>
						</button>
						{#if showRuleMenu}
							<button type="button" class="fixed inset-0 z-[110]" on:click={() => (showRuleMenu = false)} aria-label={$t("Close rule menu")}></button>
							<div class="gh-dropdown-menu right-0 top-full w-56" transition:slide={{ duration: 150 }}>
								<div class="gh-dropdown-body flex flex-col gap-0.5">
									<button type="button" class="gh-dropdown-item font-semibold text-accent-fg" on:click={() => { resetRuleForm(); showRuleMenu = false; }}>
										+ {$t("New Rule")}
									</button>
									{#if $appState.aggregates.length}
										<div class="border-t border-border-default my-1"></div>
										{#each $appState.aggregates as rule}
											<button type="button" class={cn("gh-dropdown-item", editingRuleId === rule.id ? "font-semibold text-fg-default" : "text-fg-default")} on:click={() => { loadRule(rule); showRuleMenu = false; }}>
												<span class="min-w-0 flex-1 truncate">{rule.name}</span>
												{#if editingRuleId === rule.id}
													<span class="gh-label">{$t("Active")}</span>
												{/if}
											</button>
										{/each}
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
				<div class="gh-section-body gap-6">
					<!-- Basics -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.ruleName}>{$t("Rule Name")}</label>
							<input id={fieldIds.ruleName} class="gh-input" placeholder="e.g. Global" bind:value={ruleName} />
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.excludeTags}>{$t("Exclude Tags")}</label>
							<input
								id={fieldIds.excludeTags}
								class="gh-input"
								placeholder="domestic, bypass..."
								bind:value={excludeTags}
								on:input={handleExcludeTagsInput}
							/>
							{#if excludeTagIdsMigrated}
								<p class="flex items-start gap-1.5 text-xs text-attention-fg">
									<Octicon icon={alert} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									<span>{$t("Legacy excluded tag IDs were converted to labels. Save this rule to persist the migration.")}</span>
								</p>
							{/if}
							{#if excludeTagMigrationWarnings.length > 0}
								<p class="flex items-start gap-1.5 text-xs text-danger-fg">
									<Octicon icon={alert} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									<span>
										{$t("Some legacy excluded tag values need review and were preserved: {tags}", {
											tags: excludeTagMigrationWarnings.map((warning) => warning.value).join(", "),
										})}
									</span>
								</p>
							{/if}
						</div>
					</div>

					<!-- Selection Dropdowns -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
						<!-- Nodes Dropdown -->
						<div class="flex flex-col gap-1.5 relative">
							<div id={`${fieldIds.nodesMenu}-label`} class="gh-form-label">{$t("Source Nodes")}</div>
							<button 
								type="button"
								id={fieldIds.nodesMenu}
								class="gh-select w-full text-left flex items-center justify-between" 
								on:click={() => { showNodesMenu = !showNodesMenu; showSubsMenu = false; }}
								aria-haspopup="dialog"
								aria-expanded={showNodesMenu}
								aria-labelledby={`${fieldIds.nodesMenu}-label ${fieldIds.nodesMenu}`}
							>
								<span class="truncate">
									{activeNodeCount > 0 ? $t("{count} nodes selected", { count: activeNodeCount }) : $t("Select nodes...")}
								</span>
							</button>
							
							{#if showNodesMenu}
								<button type="button" class="fixed inset-0 z-[110]" on:click={() => (showNodesMenu = false)} aria-label={$t("Close source nodes menu")}></button>
								<div class="gh-dropdown-menu left-0 top-full w-full min-w-[280px]" transition:slide={{ duration: 150 }}>
									<div class="gh-dropdown-header">
										<div class="relative">
											<Octicon icon={search} className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
											<label class="sr-only" for={fieldIds.nodeSearch}>{$t("Filter nodes")}</label>
											<input id={fieldIds.nodeSearch} class="gh-input pl-8 h-7 text-xs w-full" placeholder={$t("Filter nodes...")} bind:value={nodeSearchQuery} />
										</div>
									</div>
									<div class="gh-dropdown-body flex flex-col gap-0.5">
										<button type="button" class="gh-dropdown-item font-semibold text-accent-fg" on:click={selectAllNodes}>
											<Octicon icon={checklist} className="h-3.5 w-3.5" /> {$t("Select visible")}
										</button>
										<div class="border-t border-border-default my-1"></div>
										{#each filteredNodesInRule as node}
											<label class="gh-dropdown-item">
												<input type="checkbox" class="rounded border-border-default" checked={selectedNodeIds.includes(node.id)} on:change={() => (selectedNodeIds = toggleSelection(selectedNodeIds, node.id))} />
												<span class="min-w-0 flex-1 truncate">{node.name}</span>
												<span class="gh-label">{node.type}</span>
											</label>
										{/each}
										{#if !filteredNodesInRule.length}<p class="text-[10px] text-fg-muted p-4 text-center italic">{$t("No nodes found")}</p>{/if}
									</div>
								</div>
							{/if}
						</div>

						<!-- Subscriptions Dropdown -->
						<div class="flex flex-col gap-1.5 relative">
							<div id={`${fieldIds.subsMenu}-label`} class="gh-form-label">{$t("Source Subscriptions")}</div>
							<button 
								type="button"
								id={fieldIds.subsMenu}
								class="gh-select w-full text-left flex items-center justify-between" 
								on:click={() => { showSubsMenu = !showSubsMenu; showNodesMenu = false; }}
								aria-haspopup="dialog"
								aria-expanded={showSubsMenu}
								aria-labelledby={`${fieldIds.subsMenu}-label ${fieldIds.subsMenu}`}
							>
								<span class="truncate">
									{activeSubCount > 0 ? $t("{count} subs selected", { count: activeSubCount }) : $t("Select subscriptions...")}
								</span>
							</button>

							{#if showSubsMenu}
								<button type="button" class="fixed inset-0 z-[110]" on:click={() => (showSubsMenu = false)} aria-label={$t("Close source subscriptions menu")}></button>
								<div class="gh-dropdown-menu left-0 top-full w-full min-w-[280px]" transition:slide={{ duration: 150 }}>
									<div class="gh-dropdown-header">
										<div class="relative">
											<Octicon icon={search} className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
											<label class="sr-only" for={fieldIds.subSearch}>{$t("Filter subscriptions")}</label>
											<input id={fieldIds.subSearch} class="gh-input pl-8 h-7 text-xs w-full" placeholder={$t("Filter subs...")} bind:value={subSearchQuery} />
										</div>
									</div>
									<div class="gh-dropdown-body flex flex-col gap-0.5">
										<button type="button" class="gh-dropdown-item font-semibold text-accent-fg" on:click={selectAllSubs}>
											<Octicon icon={checklist} className="h-3.5 w-3.5" /> {$t("Select visible")}
										</button>
										<div class="border-t border-border-default my-1"></div>
										{#each filteredSubsInRule as sub}
											<label class="gh-dropdown-item">
												<input type="checkbox" class="rounded border-border-default" checked={selectedSubscriptionIds.includes(sub.id)} on:change={() => (selectedSubscriptionIds = toggleSelection(selectedSubscriptionIds, sub.id))} />
												<span class="min-w-0 flex-1 truncate">{sub.name}</span>
											</label>
										{/each}
										{#if !filteredSubsInRule.length}<p class="text-[10px] text-fg-muted p-4 text-center italic">{$t("No subs found")}</p>{/if}
									</div>
								</div>
							{/if}
						</div>
					</div>

					<!-- Allowed Types -->
					<div class="flex flex-col gap-2">
						<div id={fieldIds.allowedTypes} class="text-sm font-semibold">{$t("Allowed Protocols")}</div>
						<div class="gh-btn-group flex-wrap" role="group" aria-labelledby={fieldIds.allowedTypes}>
							{#each protocolOptions as opt}
								<button 
									type="button"
									class={cn("gh-btn gh-btn-sm", allowedTypes.includes(opt.id) ? "gh-btn-primary" : "bg-canvas-default")}
									on:click={() => (allowedTypes = toggleSelection(allowedTypes, opt.id))}
								>
									{opt.label}
								</button>
							{/each}
						</div>
						<p class="gh-form-caption">{$t("Leave empty to allow all protocols.")}</p>
					</div>

					<!-- Sorting Configuration -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.sortMode}>{$t("Sort Mode")}</label>
							<GitHubSelect id={fieldIds.sortMode} bind:value={sortMode} options={sortModeOptions} />
						</div>
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.sortPriority}>{$t("Priority Keywords (per line)")}</label>
							<textarea id={fieldIds.sortPriority} class="gh-input gh-textarea h-20 text-xs font-mono" placeholder="e.g.\nHK\nSG" bind:value={sortPriority}></textarea>
						</div>
					</div>

					<!-- Rename Rules -->
					<div class="flex flex-col gap-1.5">
						<label class="gh-form-label" for={fieldIds.renameMap}>{$t("Rename Rules")}</label>
						<textarea id={fieldIds.renameMap} class="gh-input gh-textarea font-mono text-xs" placeholder="Old Name = New Name" bind:value={renameMap}></textarea>
						<p class="gh-form-caption">
							{$t("Supports Regex: /pattern/flags = replacement (e.g. /^HK-(.*)/ = Hong Kong $1)")}
						</p>
					</div>

					<!-- Region Flags -->
					<div class="flex flex-col gap-3">
						<div class="flex items-center justify-between">
							<label class="gh-form-label flex items-center gap-2" for={fieldIds.customRegionFlagMap}><Octicon icon={globe} className="h-4 w-4" />{$t("Region Flag Map")}</label>
							<button type="button" class="gh-link text-xs" on:click={() => (showBuiltInRegionMap = true)}>{$t("Browse Icons")}</button>
						</div>
						<textarea id={fieldIds.customRegionFlagMap} class="gh-input gh-textarea font-mono text-xs h-32" placeholder="US = US, USA, America" bind:value={customRegionFlagMap}></textarea>
						
						<div class="gh-checkbox-row">
							<input id={fieldIds.prependRegionFlags} type="checkbox" class="rounded border-border-default" bind:checked={prependRegionFlags} />
							<div class="flex flex-col">
								<label class="text-sm font-medium" for={fieldIds.prependRegionFlags}>{$t("Auto-prepend Region Flags")}</label>
								<span class="gh-form-caption">{$t("Uses emoji flags based on country codes")}</span>
							</div>
						</div>
					</div>
				</div>
				<div class="gh-section-footer">
					<div class="gh-btn-group">
						{#if editingRuleId}
								<button type="button" class="gh-btn gh-btn-danger" on:click={deleteRule} aria-label={$t("Delete current rule")} title={$t("Delete current rule")} disabled={deletingRuleId === editingRuleId}>{#if deletingRuleId === editingRuleId}<Octicon icon={sync} className="h-4 w-4 animate-spin" />{:else}<Octicon icon={trash} className="h-4 w-4" />{/if}</button>
						{/if}
						<button type="button" class="gh-btn" on:click={buildPreview} disabled={previewLoading}>
							{#if previewLoading}<Octicon icon={sync} className="mr-1 h-4 w-4 animate-spin" />{:else}<Octicon icon={eye} className="mr-1 h-4 w-4" />{/if}
							{$t("Preview")}
						</button>
						<button type="button" class="gh-btn gh-btn-primary px-8" on:click={saveRule}><Octicon icon={checkCircle} className="mr-1 h-4 w-4" />{$t("Save")}</button>
					</div>
				</div>
			</div>

			{#if previewEntries.length > 0}
				<div class="gh-box shadow-sm" transition:slide>
					<div class="gh-box-header">
						<div class="flex items-center gap-2">
							<Octicon icon={fileCode} className="h-4 w-4" />
							<span>{$t("Preview Results")}</span>
							<span class="badge ml-2">{previewEntries.length} {$t("Nodes")}</span>
							<span class="badge">{previewSource === "draft" ? $t("Draft Preview") : $t("Saved Rule Preview")}</span>
							{#if previewGeneratedText}
								<span class="text-xs font-normal text-fg-muted">{$t("Preview generated {time}", { time: previewGeneratedText })}</span>
							{/if}
						</div>
						<button type="button" class="gh-icon-button h-7 w-7" on:click={() => (previewEntries = [])} aria-label={$t("Close preview results")}><Octicon icon={x} className="h-4 w-4" /></button>
					</div>
					<div 
						class="flex max-h-96 flex-col gap-1 overflow-y-auto bg-canvas-default p-2"
						use:dndzone={{ items: previewEntries, flipDurationMs: 200, dragDisabled: false }}
						on:consider={handlePreviewDndConsider}
						on:finalize={handlePreviewDndFinalize}
					>
						{#each previewEntries as entry (entry.id)}
							<div class="group flex cursor-grab items-center justify-between rounded-md border border-transparent bg-canvas-default p-2 transition-colors hover:border-border-default hover:bg-canvas-subtle active:cursor-grabbing">
								<div class="flex items-center gap-3 min-w-0">
									<div class="text-fg-subtle shrink-0">
										<div class="grid grid-cols-2 gap-px opacity-50" aria-hidden="true">
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
											<span class="h-1 w-1 rounded-full bg-current"></span>
										</div>
									</div>
									<span class="gh-label shrink-0">{entry.protocol}</span>
									<span class="text-xs font-bold truncate">{entry.name}</span>
								</div>
								<button type="button" class="gh-btn gh-btn-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" on:click={() => copyLine(entry.line)} aria-label={$t("Copy preview line")}><Octicon icon={copy} className="h-3.5 w-3.5" /></button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Sidebar: Publish Settings -->
		<aside class="gh-layout-aside">
				<div class="gh-box shadow-sm !overflow-visible">
					<div class="gh-box-header text-sm">
						<div class="flex items-center gap-2"><Octicon icon={upload} className="h-4 w-4" />{$t("Publish to Gist")}</div>
						<span class="badge">{$appState.publishTargets.length}</span>
					</div>
					<div class="gh-section-body">
						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.targetSelect}>{$t("Select Target")}</label>
							<GitHubSelect id={fieldIds.targetSelect} bind:value={selectedTargetId} options={targetSelectOptions} onValueChange={(id) => { const target = $appState.publishTargets.find(t => t.id === id); target ? loadPublishTarget(target) : resetTargetForm(); }} />
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.targetName}>{$t("Target name")}</label>
							<input id={fieldIds.targetName} class="gh-input" placeholder={$t("Target name")} bind:value={publishTargetName} />
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.targetRule}>{$t("Binding Rule")}</label>
							<GitHubSelect id={fieldIds.targetRule} bind:value={publishTargetRuleId} options={targetRuleOptions} placeholder={$t("Select an Aggregate rule")} />
						</div>

						<div class="flex flex-col gap-1.5">
							<label class="gh-form-label" for={fieldIds.targetFile}>{$t("Output File")}</label>
							<input id={fieldIds.targetFile} class="gh-input font-mono" placeholder="nodes.txt" bind:value={publishTargetFile} />
						</div>
						{#if selectedTargetNeedsRepublish}
							<div class="gh-alert gh-alert-warning text-xs">
								{$t("Target configuration changed after its last publish. Publish again to refresh the output and stable link.")}
							</div>
						{/if}

						<div class="flex flex-col gap-2 pt-2 border-t border-border-default">
							<button type="button" class="gh-btn w-full" on:click={saveTarget}>{$t("Save Target")}</button>
							{#if selectedTargetId}
									<button type="button" class="gh-btn gh-btn-danger w-full" on:click={deleteTarget} disabled={deletingTargetId === selectedTargetId}>
										{#if deletingTargetId === selectedTargetId}<Octicon icon={sync} className="h-4 w-4 animate-spin" />{:else}<Octicon icon={trash} className="h-4 w-4" />{/if}
									{$t("Delete Target")}
								</button>
							{/if}
							{#if isWorkspaceConnected}
								<button type="button" class="gh-btn gh-btn-primary w-full py-3 h-auto" on:click={publish} disabled={ordinaryPublishDisabled}>
									{#if publishing}<Octicon icon={sync} className="h-4 w-4 animate-spin" />{:else}<Octicon icon={upload} className="h-4 w-4" />{/if}
									{$t("Publish")}
								</button>
								<button type="button" class="gh-btn w-full" on:click={saveAndPublish} disabled={publishing || Boolean(selectedOutputConflict)}>
									<Octicon icon={upload} className="h-4 w-4" />
									{workspaceIsManual ? $t("Push and Publish") : $t("Save and Publish")}
								</button>
							{:else}
								<a href="/auth" class="gh-btn gh-btn-primary w-full py-3 h-auto">
									<Octicon icon={database} className="h-4 w-4" />
									{$t("Connect to Publish")}
								</a>
							{/if}
						</div>

						{#if publishUrl}
							<div class="gh-alert gh-alert-success mt-2 flex-col gap-2" in:fade>
								<div class="flex items-center justify-between text-xs font-semibold text-[color:var(--success-emphasis)]">
									<span>{$t("Live Link")}</span>
									<Octicon icon={checkCircle} className="h-3 w-3" />
								</div>
								<code class="gh-code-block break-all">{publishUrl}</code>
									<button type="button" class="gh-btn gh-btn-sm" on:click={async () => { 
										try {
										if (!publishUrl) return;
										await navigator.clipboard.writeText(publishUrl); 
										showToast($t("Link copied to clipboard"), 'success'); 
								} catch {
									showToast($t("Copy failed"), 'error');
								}
							}}><Octicon icon={copy} className="h-3 w-3" />{$t("Copy")}</button>
						</div>
					{/if}
				</div>
			</div>

			{#if !$authState.token}
				<div class="blankslate p-4 py-6">
					<Octicon icon={database} className="mb-2 h-8 w-8 text-fg-subtle" />
					<p class="mb-3 text-xs leading-relaxed text-fg-muted">{$t("Connect GitHub to sync and publish from a gist.")}</p>
					<a href="/auth" class="gh-btn gh-btn-sm">{$t("Go to Settings")}</a>
				</div>
			{/if}
		</aside>
	</div>
</div>

<!-- Region Flags Browser Modal -->
{#if showBuiltInRegionMap}
	<div class="fixed inset-0 z-[150] flex items-center justify-center p-4">
		<button type="button" class="fixed inset-0 bg-black/60 backdrop-blur-sm" on:click={() => (showBuiltInRegionMap = false)} aria-label={$t("Close region flag rules")}></button>
		<div class="gh-box relative flex max-h-[85vh] w-full max-w-4xl flex-col bg-canvas-default shadow-[var(--shadow-medium)]" in:fly={{ y: 20 }}>
				<div class="gh-box-header">
					<div class="flex items-center gap-2">
						<Octicon icon={globe} className="h-4 w-4" />
						<span>{$t("Built-in Region Flag Rules")}</span>
					</div>
					<button type="button" class="gh-icon-button h-7 w-7" on:click={() => (showBuiltInRegionMap = false)} aria-label={$t("Close region flag rules")}><Octicon icon={x} className="h-4 w-4" /></button>
				</div>
				
				<div class="border-b border-border-default bg-canvas-subtle p-4">
					<div class="relative">
						<Octicon icon={search} className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
						<label class="sr-only" for={fieldIds.builtInRegionMapSearch}>{$t("Search code or keyword")}</label>
						<input id={fieldIds.builtInRegionMapSearch} class="gh-input pl-9 h-10" placeholder={$t("Search code or keyword...")} bind:value={builtInRegionMapSearch} />
					</div>
				</div>

			<div class="flex-1 overflow-y-auto p-4">
				<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
					{#each filteredRegionRules as rule}
						<button 
							class="group flex flex-col gap-2 rounded-md border border-border-default bg-canvas-subtle p-3 text-left transition-colors hover:border-accent-emphasis hover:bg-canvas-default"
							on:click={() => insertRegionRule(rule)}
						>
							<div class="flex items-center gap-3">
								<span class="text-2xl shrink-0">{regionCodeToFlagEmoji(rule.code)}</span>
								<span class="font-bold text-sm text-accent-fg group-hover:underline">{rule.code}</span>
							</div>
							<p class="text-[10px] text-fg-muted line-clamp-2 leading-relaxed">
								{rule.keywords.join(", ")}
							</p>
						</button>
					{/each}
				</div>
			</div>
			
			<div class="gh-section-footer">
				<button type="button" class="gh-btn" on:click={() => (showBuiltInRegionMap = false)}>{$t("Close")}</button>
			</div>
		</div>
	</div>
{/if}
