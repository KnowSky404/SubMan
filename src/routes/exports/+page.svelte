<script lang="ts">
import {
	createDefaultSingBoxClientProfile,
	hasClientExportOutputChanged,
	normalizeExportFileName,
} from "$lib/client-export/profile";
import {
	buildSingBoxClientConfig,
	type SingBoxClientBuildResult,
} from "$lib/client-export/sing-box";
import GitHubSelect from "$lib/components/GitHubSelect.svelte";
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import type { ClientExportProfile } from "$lib/models";
import {
	checkCircle,
	copy,
	database,
	download,
	fileCode,
	pencil,
	trash,
	upload,
} from "$lib/octicons";
import {
	appState,
	removeClientExport,
	upsertClientExport,
	type WorkspaceActionResult,
} from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { requestConfirm } from "$lib/stores/confirm";
import { showToast } from "$lib/stores/toast";
import { cn } from "$lib/utils/cn";
import { nowIso } from "$lib/utils/time";
import { submitBrowserWorkspaceMutation } from "$lib/workspace-browser-session-v2";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import { findWorkspaceOutputConflicts } from "$lib/workspace-output";
import { workspaceSyncStatus } from "$lib/workspace-sync-status";
import { WorkspaceV2StateStore } from "$lib/workspace-v2-state";

let selectedProfileId = "";
let previewContent = "";
let previewSignature = "";
let previewWarnings: string[] = [];
let previewErrors: string[] = [];
let totalLines = 0;
let outboundCount = 0;
let skippedCount = 0;
let publishing = false;

let draftName = "";
let draftFileName = "";
let draftRuleId = "";
let draftListenAddress = "";
let draftListenPort = "2080";
let draftSelectorTag = "";
let draftUrlTestTag = "";
let draftIncludeExperimental = true;
let syncedDraftProfileSignature = "";

$: firstProfile = $appState.clientExports[0] ?? null;
$: firstRule = $appState.aggregates[0] ?? null;
$: {
	const selectedProfileExists = $appState.clientExports.some(
		(profile) => profile.id === selectedProfileId,
	);
	if (firstProfile && !selectedProfileExists)
		selectedProfileId = firstProfile.id;
	if (!firstProfile) selectedProfileId = "";
}
$: selectedProfile =
	$appState.clientExports.find((profile) => profile.id === selectedProfileId) ??
	null;
$: selectedRule =
	$appState.aggregates.find((rule) => rule.id === selectedProfile?.ruleId) ??
	null;
$: profileCount = $appState.clientExports.length;
$: canCreateProfile = !!firstRule;
$: ruleOptions = $appState.aggregates.map((rule) => ({
	value: rule.id,
	label: rule.name,
}));
$: currentSignature = selectedProfile
	? JSON.stringify({
			profile: {
				id: selectedProfile.id,
				name: selectedProfile.name,
				ruleId: selectedProfile.ruleId,
				fileName: selectedProfile.fileName,
				options: selectedProfile.options,
				updatedAt: selectedProfile.updatedAt,
			},
			ruleId: selectedRule?.id ?? null,
			lastUpdated: $appState.lastUpdated,
		})
	: "";
$: profileDirty = selectedProfile
	? JSON.stringify({
			name: draftName.trim() || "sing-box Client",
			fileName: normalizeExportFileName(draftFileName),
			ruleId: draftRuleId.trim(),
			listenAddress: draftListenAddress.trim(),
			listenPort: draftListenPort,
			selectorTag: draftSelectorTag.trim(),
			urlTestTag: draftUrlTestTag.trim(),
			includeExperimental: draftIncludeExperimental,
		}) !==
		JSON.stringify({
			name: selectedProfile.name,
			fileName: selectedProfile.fileName,
			ruleId: selectedProfile.ruleId,
			listenAddress: selectedProfile.options.listenAddress,
			listenPort: String(selectedProfile.options.listenPort),
			selectorTag: selectedProfile.options.selectorTag,
			urlTestTag: selectedProfile.options.urlTestTag,
			includeExperimental: selectedProfile.options.includeExperimental,
		})
	: false;
$: outputConflicts = findWorkspaceOutputConflicts($appState);
$: selectedOutputConflict = outputConflicts.find(
	(conflict) => conflict.fileName === selectedProfile?.fileName,
);
$: workspaceIsManual = $workspaceSyncStatus.mode === "manual";
$: publishDisabled =
	!$authState.token ||
	!$appState.activeGistId ||
	!selectedProfile ||
	previewSignature !== currentSignature ||
	!previewContent ||
	outboundCount <= 0 ||
	previewErrors.length > 0 ||
	profileDirty ||
	Boolean(selectedOutputConflict) ||
	workspaceIsManual ||
	publishing;

$: if (
	selectedProfile &&
	syncedDraftProfileSignature !== getProfileDraftSignature(selectedProfile)
) {
	syncDraftFromProfile(selectedProfile);
}

function getProfileDraftSignature(profile: ClientExportProfile): string {
	return JSON.stringify({
		id: profile.id,
		updatedAt: profile.updatedAt,
	});
}

function syncDraftFromProfile(profile: ClientExportProfile): void {
	syncedDraftProfileSignature = getProfileDraftSignature(profile);
	draftName = profile.name;
	draftFileName = profile.fileName;
	draftRuleId = profile.ruleId;
	draftListenAddress = profile.options.listenAddress;
	draftListenPort = String(profile.options.listenPort);
	draftSelectorTag = profile.options.selectorTag;
	draftUrlTestTag = profile.options.urlTestTag;
	draftIncludeExperimental = profile.options.includeExperimental;
}

function clearPreview(): void {
	previewContent = "";
	previewSignature = "";
	previewWarnings = [];
	previewErrors = [];
	totalLines = 0;
	outboundCount = 0;
	skippedCount = 0;
}

function showDeleteActionFeedback(
	status: WorkspaceActionResult["status"],
): void {
	showToast(
		status === "committed"
			? $t("Deleted export profile")
			: status === "queued"
				? $t("Queued")
				: $t("Saved locally"),
		"success",
	);
}

function getProfileRuleName(profile: ClientExportProfile): string {
	return (
		$appState.aggregates.find((rule) => rule.id === profile.ruleId)?.name ||
		$t("Missing Aggregate rule")
	);
}

function selectProfile(profileId: string): void {
	if (selectedProfileId === profileId) return;
	selectedProfileId = profileId;
	clearPreview();
}

function editProfile(profile: ClientExportProfile): void {
	selectProfile(profile.id);
}

function createProfile(): void {
	if (!firstRule) return;

	const profile = createDefaultSingBoxClientProfile(firstRule.id, nowIso());
	const ownedFileNames = new Set([
		...$appState.publishTargets.map((target) => target.fileName),
		...$appState.clientExports.map((item) => item.fileName),
	]);
	let suffix = 1;
	while (ownedFileNames.has(profile.fileName)) {
		suffix += 1;
		profile.fileName = `sing-box-client-${suffix}.json`;
	}
	if (!upsertClientExport(profile).accepted) return;
	selectedProfileId = profile.id;
	syncDraftFromProfile(profile);
	clearPreview();
}

function saveProfile(): void {
	if (!selectedProfile) return;

	const listenPort = Number(draftListenPort);
	if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
		showToast($t("Listen port must be between 1 and 65535"), "error");
		return;
	}

	const now = nowIso();
	const draftProfile: ClientExportProfile = {
		...selectedProfile,
		name: draftName.trim() || "sing-box Client",
		fileName: normalizeExportFileName(draftFileName) || "sing-box-client.json",
		ruleId: draftRuleId.trim(),
		options: {
			...selectedProfile.options,
			listenAddress: draftListenAddress.trim(),
			listenPort,
			selectorTag: draftSelectorTag.trim(),
			urlTestTag: draftUrlTestTag.trim(),
			includeExperimental: draftIncludeExperimental,
		},
		updatedAt: now,
	};
	const outputChanged = hasClientExportOutputChanged(
		selectedProfile,
		draftProfile,
	);
	const nextProfile: ClientExportProfile = outputChanged
		? {
				...draftProfile,
				lastGeneratedAt: null,
				lastPublishedAt: null,
				lastPublishedUrl: null,
			}
		: draftProfile;

	if (!upsertClientExport(nextProfile).accepted) return;
	selectedProfileId = nextProfile.id;
	syncDraftFromProfile(nextProfile);
	clearPreview();
}

async function deleteProfile(profile: ClientExportProfile): Promise<void> {
	const confirmed = await requestConfirm({
		title: $t("Delete Profile"),
		message: $t("Delete export profile {name}?", { name: profile.name }),
		confirmText: $t("Delete"),
		danger: true,
	});
	if (!confirmed) return;

	const handle = removeClientExport(profile.id);
	if (!handle.accepted) return;
	const result = await handle.completion;
	if (
		result.status === "rejected" ||
		result.status === "permanent-error" ||
		result.status === "invalid-local-state"
	)
		return;
	if (selectedProfileId === profile.id) {
		selectedProfileId = "";
	}
	clearPreview();
	showDeleteActionFeedback(result.status);
}

async function refreshPreview(): Promise<string> {
	if (!selectedProfile) {
		clearPreview();
		previewErrors = [$t("Create an export profile first")];
		return "";
	}

	const generatedSignature = currentSignature;
	const result = await buildSingBoxClientConfig(
		selectedProfile,
		selectedRule,
		$appState.nodes,
		$appState.subscriptions,
	);

	previewContent = result.content;
	previewWarnings = result.warnings;
	previewErrors = result.errors;
	totalLines = result.totalLines;
	outboundCount = result.outbounds;
	skippedCount = result.skipped;
	previewSignature = generatedSignature;

	return result.content;
}

function formatPreviewWarning(warning: string): string {
	const prefix = "excluded-tag-needs-review:";
	return warning.startsWith(prefix)
		? $t("Excluded tag value needs review: {tag}", {
				tag: warning.slice(prefix.length),
			})
		: warning;
}

async function copyPreview(): Promise<void> {
	const content = await refreshPreview();
	if (!content) return;

	await navigator.clipboard.writeText(content);
	showToast($t("Copied sing-box config"), "success");
}

async function downloadPreview(): Promise<void> {
	const content = await refreshPreview();
	if (!content) return;

	const fileName = selectedProfile
		? normalizeExportFileName(selectedProfile.fileName) ||
			"sing-box-client.json"
		: "sing-box-client.json";
	const blob = new Blob([content], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

async function copyPublishedUrl(): Promise<void> {
	if (!selectedProfile?.lastPublishedUrl) return;

	await navigator.clipboard.writeText(selectedProfile.lastPublishedUrl);
	showToast($t("Link copied to clipboard"), "success");
}

async function publishPreview(): Promise<void> {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	if (!token || !gistId || !selectedProfile) return;

	publishing = true;
	try {
		const profileId = selectedProfile.id;
		const publicationBuild = await buildSingBoxClientConfig(
			selectedProfile,
			selectedRule,
			$appState.nodes,
			$appState.subscriptions,
		);
		if (
			publicationBuild.errors.length > 0 ||
			!publicationBuild.content ||
			publicationBuild.outbounds <= 0
		) {
			throw new Error(publicationBuild.errors[0] ?? "No output generated");
		}
		await submitBrowserWorkspaceMutation(
			{
				token,
				kind: "client-export.publish",
				payload: {
					profileId,
					output: {
						fileName: normalizeExportFileName(selectedProfile.fileName),
						content: publicationBuild.content,
					},
				},
			},
			{
				queue: new WorkspaceMutationQueue(),
				stateStore: new WorkspaceV2StateStore(),
				getState: () => $appState,
				setState: (state) => appState.set(state),
			},
		);
		if (publicationBuild) {
			previewContent = publicationBuild.content;
			previewWarnings = publicationBuild.warnings;
			previewErrors = publicationBuild.errors;
			totalLines = publicationBuild.totalLines;
			outboundCount = publicationBuild.outbounds;
			skippedCount = publicationBuild.skipped;
		}
		showToast($t("Published sing-box config"), "success");
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
</script>

<svelte:head>
	<title>{$t("Exports")} - SubMan</title>
</svelte:head>

<div class="gh-page">
	<header class="gh-page-header">
		<div class="gh-page-heading">
			<h1 class="gh-page-title">{$t("Exports")}</h1>
			<p class="gh-page-subtitle">
				{$t("Generate, inspect, download, copy, and publish sing-box client configuration profiles.")}
			</p>
			<div class="gh-page-meta">
				<span class="gh-page-meta-item">{$t("{count} profiles", { count: profileCount })}</span>
				<span class="gh-page-meta-item">{$t("{count} outbounds", { count: outboundCount })}</span>
				<span class="gh-page-meta-item">{$t("{count} warnings", { count: previewWarnings.length })}</span>
			</div>
		</div>
		<div class="gh-page-actions">
			<button class="gh-btn" type="button" on:click={copyPreview} disabled={!selectedProfile}>
				<Octicon icon={copy} className="h-4 w-4" />
				{$t("Copy")}
			</button>
			<button class="gh-btn" type="button" on:click={downloadPreview} disabled={!selectedProfile}>
				<Octicon icon={download} className="h-4 w-4" />
				{$t("Download")}
			</button>
			<button class="gh-btn gh-btn-primary" type="button" on:click={publishPreview} disabled={publishDisabled}>
				<Octicon icon={upload} className="h-4 w-4" />
				{publishing ? $t("Publishing...") : $t("Publish")}
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

	<div class="gh-layout-sidebar lg:grid-cols-[minmax(0,1fr)_360px]">
		<div class="gh-layout-main">
			<section class="gh-box !overflow-visible">
				<div class="gh-box-header">
					<div class="gh-section-title">
						<Octicon icon={fileCode} className="h-4 w-4" />
						<span>{$t("sing-box Client")}</span>
					</div>
					<span class="gh-counter">{profileCount}</span>
				</div>

				<div class="gh-section-body">
					{#if $appState.aggregates.length === 0}
						<div class="gh-alert gh-alert-attention">
							<span>{$t("Create an Aggregate rule before exporting.")}</span>
						</div>
					{:else if canCreateProfile}
						<button class="gh-btn gh-btn-primary self-start" type="button" on:click={createProfile}>
							{$t("New profile")}
						</button>
					{/if}

					{#if $appState.clientExports.length > 0}
						<div class="overflow-hidden rounded-md border border-border-default">
							<div class="gh-list-header hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
								<span>{$t("Profiles")}</span>
								<span>{$t("Source Aggregate Rule")}</span>
								<span class="text-right">{$t("Actions")}</span>
							</div>
							{#each $appState.clientExports as profile}
								<div
									class={cn(
										"gh-box-row group",
										profile.id === selectedProfileId && "bg-accent-subtle",
									)}
								>
									<div class="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
										<button
											type="button"
											class="gh-row-main min-w-0 text-left"
											on:click={() => selectProfile(profile.id)}
										>
											<Octicon icon={fileCode} className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
											<span class="min-w-0 space-y-1">
												<span class="gh-row-title block truncate">{profile.name}</span>
												<span class="gh-list-meta-code block truncate">{profile.fileName}</span>
											</span>
										</button>
										<div class="min-w-0 text-sm text-fg-muted">
											{getProfileRuleName(profile)}
										</div>
										<div class="flex justify-end gap-2">
											<button
												type="button"
												class="gh-btn gh-btn-sm"
												on:click={() => editProfile(profile)}
												aria-label={$t("Edit export profile")}
												title={$t("Edit export profile")}
											>
												<Octicon icon={pencil} className="h-3.5 w-3.5" />
												{$t("Edit")}
											</button>
											<button
												type="button"
												class="gh-btn gh-btn-sm gh-btn-danger"
												on:click={() => deleteProfile(profile)}
												aria-label={$t("Delete export profile")}
											>
												<Octicon icon={trash} className="h-3.5 w-3.5" />
												{$t("Delete")}
											</button>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if selectedProfile}
						<div class="grid gap-4 md:grid-cols-2">
							<div class="space-y-2">
								<label class="gh-form-label" for="exports-name">{$t("Name")}</label>
								<input id="exports-name" class="gh-input" bind:value={draftName} />
							</div>
							<div class="space-y-2">
								<label class="gh-form-label" for="exports-file-name">{$t("File Name")}</label>
								<input
									id="exports-file-name"
									class="gh-input font-mono"
									bind:value={draftFileName}
								/>
							</div>
							<div class="space-y-2">
								<label class="gh-form-label" for="exports-source-rule">
									{$t("Source Aggregate Rule")}
								</label>
								<GitHubSelect
									id="exports-source-rule"
									bind:value={draftRuleId}
									options={ruleOptions}
									placeholder={$t("Select an Aggregate rule")}
								/>
							</div>
							<div class="space-y-2">
								<label class="gh-form-label" for="exports-listen-address">
									{$t("Listen Address")}
								</label>
								<input
									id="exports-listen-address"
									class="gh-input font-mono"
									bind:value={draftListenAddress}
								/>
							</div>
							<div class="space-y-2">
								<label class="gh-form-label" for="exports-listen-port">
									{$t("Listen Port")}
								</label>
								<input
									id="exports-listen-port"
									class="gh-input"
									type="number"
									min="1"
									max="65535"
									bind:value={draftListenPort}
								/>
							</div>
							<div class="space-y-2">
								<label class="gh-form-label" for="exports-selector-tag">
									{$t("Selector Tag")}
								</label>
								<input
									id="exports-selector-tag"
									class="gh-input font-mono"
									bind:value={draftSelectorTag}
								/>
							</div>
							<div class="space-y-2">
								<label class="gh-form-label" for="exports-url-test-tag">
									{$t("URL Test Tag")}
								</label>
								<input
									id="exports-url-test-tag"
									class="gh-input font-mono"
									bind:value={draftUrlTestTag}
								/>
							</div>
							<label class="gh-checkbox-row md:mt-7">
								<input type="checkbox" bind:checked={draftIncludeExperimental} />
								<span class="text-sm font-medium">{$t("Include Experimental")}</span>
							</label>
						</div>
					{/if}
				</div>

				{#if selectedProfile}
					<div class="gh-section-footer">
						<button class="gh-btn gh-btn-primary" type="button" on:click={saveProfile}>
							{$t("Save")}
						</button>
						<button class="gh-btn" type="button" on:click={refreshPreview}>
							{$t("Generate Preview")}
						</button>
						<span class="badge">{$t("Workspace")}</span>
						<span class="text-sm text-fg-muted">
							{selectedRule ? selectedRule.name : $t("Select an Aggregate rule")}
						</span>
					</div>
				{/if}
			</section>

			<section class="gh-box overflow-hidden">
				<div class="gh-box-header">
					<h2 class="gh-section-title">{$t("Preview")}</h2>
				</div>
				<pre class="max-h-[36rem] overflow-auto p-4 font-mono text-xs text-fg-default">{previewContent || $t("Generate a preview to inspect config.json")}</pre>
			</section>
		</div>

		<aside class="gh-layout-aside">
			<section class="gh-box overflow-hidden">
				<div class="gh-box-header">
					<h2 class="gh-section-title">{$t("Summary")}</h2>
				</div>
				<div class="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-1">
					<div>
						<div class="text-xs text-fg-muted">{$t("Total Lines")}</div>
						<div class="text-lg font-semibold text-fg-default">{totalLines}</div>
					</div>
					<div>
						<div class="text-xs text-fg-muted">{$t("Outbounds")}</div>
						<div class="text-lg font-semibold text-fg-default">{outboundCount}</div>
					</div>
					<div>
						<div class="text-xs text-fg-muted">{$t("Skipped")}</div>
						<div class="text-lg font-semibold text-fg-default">{skippedCount}</div>
					</div>
					<div>
						<div class="text-xs text-fg-muted">{$t("Warning Count")}</div>
						<div class="text-lg font-semibold text-fg-default">{previewWarnings.length}</div>
					</div>
				</div>
			</section>

			<section class="gh-box overflow-hidden">
				<div class="gh-box-header">
					<h2 class="gh-section-title">
						<Octicon icon={upload} className="h-4 w-4" />
						{$t("Publish to Gist")}
					</h2>
				</div>
				<div class="space-y-4 p-4">
					<div class="space-y-1">
						<div class="text-xs text-fg-muted">{$t("Output File")}</div>
						<code class="gh-list-meta-code block truncate">
							{selectedProfile
								? normalizeExportFileName(selectedProfile.fileName) ||
									"sing-box-client.json"
								: "sing-box-client.json"}
						</code>
					</div>
					<p class="text-xs leading-relaxed text-fg-muted">
						{$t("Publish the generated JSON to the workspace gist, then copy the raw URL as a remote profile URL for compatible sing-box clients.")}
					</p>
					{#if workspaceIsManual}
						<div class="gh-alert gh-alert-warning text-xs">
							{$t("Push local Workspace changes before publishing")}
						</div>
					{/if}
					{#if $authState.token}
						<button
							type="button"
							class="gh-btn gh-btn-primary w-full py-3 h-auto"
							on:click={publishPreview}
							disabled={publishDisabled}
						>
							<Octicon icon={upload} className="h-4 w-4" />
							{publishing ? $t("Publishing...") : $t("Publish")}
						</button>
					{:else}
						<a href="/auth" class="gh-btn gh-btn-primary w-full py-3 h-auto">
							<Octicon icon={database} className="h-4 w-4" />
							{$t("Connect to Publish")}
						</a>
					{/if}
					{#if selectedProfile?.lastPublishedUrl}
						<div class="gh-alert gh-alert-success flex-col items-stretch gap-2">
							<div class="flex items-center justify-between text-xs font-semibold text-[color:var(--success-emphasis)]">
								<span>{$t("Live Link")}</span>
								<Octicon icon={checkCircle} className="h-3 w-3" />
							</div>
							<code class="gh-code-block break-all">{selectedProfile.lastPublishedUrl}</code>
							<button type="button" class="gh-btn gh-btn-sm" on:click={copyPublishedUrl}>
								<Octicon icon={copy} className="h-3 w-3" />
								{$t("Copy remote profile URL")}
							</button>
						</div>
					{/if}
				</div>
			</section>

			{#if previewWarnings.length > 0}
				<div class="gh-alert gh-alert-attention">
					<div class="min-w-0 space-y-2">
						<h3 class="text-sm font-semibold">{$t("Warnings")}</h3>
						<ul class="space-y-1 text-sm text-fg-muted">
							{#each previewWarnings as warning}
								<li>{formatPreviewWarning(warning)}</li>
							{/each}
						</ul>
					</div>
				</div>
			{/if}

			{#if previewErrors.length > 0}
				<div class="gh-alert gh-alert-danger">
					<div class="min-w-0 space-y-2">
						<h3 class="text-sm font-semibold">{$t("Errors")}</h3>
						<ul class="space-y-1 text-sm text-fg-muted">
							{#each previewErrors as error}
								<li>{error}</li>
							{/each}
						</ul>
					</div>
				</div>
			{/if}
		</aside>
	</div>
</div>
