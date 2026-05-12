<script lang="ts">
import { t } from "$lib/i18n";
import type { ClientExportProfile } from "$lib/models";
import Octicon from "$lib/components/Octicon.svelte";
import {
	createDefaultSingBoxClientProfile,
	normalizeExportFileName,
} from "$lib/client-export/profile";
import { buildSingBoxClientConfig } from "$lib/client-export/sing-box";
import { createGist, toStableGistRawUrl, updateGist } from "$lib/gist";
import { copy, download, fileCode, upload } from "$lib/octicons";
import { exportSyncState } from "$lib/serialization";
import { appState, upsertClientExport } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { showToast } from "$lib/stores/toast";
import { nowIso } from "$lib/utils/time";
import { WORKSPACE_FILE } from "$lib/workspace";

let selectedProfileId = "";
let previewContent = "";
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
let draftListenPort = 2080;
let draftSelectorTag = "";
let draftUrlTestTag = "";
let draftIncludeExperimental = true;
let syncedDraftProfileId = "";

$: firstProfile = $appState.clientExports[0] ?? null;
$: firstRule = $appState.aggregates[0] ?? null;
$: {
	const selectedProfileExists = $appState.clientExports.some(
		(profile) => profile.id === selectedProfileId,
	);
	if (firstProfile && !selectedProfileExists) selectedProfileId = firstProfile.id;
	if (!firstProfile) selectedProfileId = "";
}
$: selectedProfile =
	$appState.clientExports.find((profile) => profile.id === selectedProfileId) ??
	null;
$: selectedRule =
	$appState.aggregates.find((rule) => rule.id === selectedProfile?.ruleId) ??
	null;
$: profileCount = $appState.clientExports.length;
$: canCreateProfile = $appState.clientExports.length === 0 && !!firstRule;
$: publishDisabled =
	!$authState.token || !selectedProfile || previewErrors.length > 0 || publishing;

$: if (selectedProfile && syncedDraftProfileId !== selectedProfile.id) {
	syncDraftFromProfile(selectedProfile);
}

function syncDraftFromProfile(profile: ClientExportProfile): void {
	syncedDraftProfileId = profile.id;
	draftName = profile.name;
	draftFileName = profile.fileName;
	draftRuleId = profile.ruleId;
	draftListenAddress = profile.options.listenAddress;
	draftListenPort = profile.options.listenPort;
	draftSelectorTag = profile.options.selectorTag;
	draftUrlTestTag = profile.options.urlTestTag;
	draftIncludeExperimental = profile.options.includeExperimental;
}

function createProfile(): void {
	if (!firstRule) return;

	const profile = createDefaultSingBoxClientProfile(firstRule.id, nowIso());
	upsertClientExport(profile);
	selectedProfileId = profile.id;
	syncDraftFromProfile(profile);
}

function saveProfile(): void {
	if (!selectedProfile) return;

	const now = nowIso();
	const nextProfile: ClientExportProfile = {
		...selectedProfile,
		name: draftName.trim() || "sing-box Client",
		fileName: normalizeExportFileName(draftFileName) || "sing-box-client.json",
		ruleId: draftRuleId.trim(),
		options: {
			...selectedProfile.options,
			listenAddress: draftListenAddress.trim(),
			listenPort: Number(draftListenPort),
			selectorTag: draftSelectorTag.trim(),
			urlTestTag: draftUrlTestTag.trim(),
			includeExperimental: draftIncludeExperimental,
		},
		updatedAt: now,
	};

	upsertClientExport(nextProfile);
	selectedProfileId = nextProfile.id;
	syncDraftFromProfile(nextProfile);
}

async function refreshPreview(): Promise<string> {
	if (!selectedProfile) {
		previewContent = "";
		previewWarnings = [];
		previewErrors = [$t("Create an export profile first")];
		totalLines = 0;
		outboundCount = 0;
		skippedCount = 0;
		return "";
	}

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

	return result.content;
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
		? normalizeExportFileName(selectedProfile.fileName) || "sing-box-client.json"
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

async function publishPreview(): Promise<void> {
	if (!$authState.token || !selectedProfile) return;

	publishing = true;
	try {
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

		if (result.errors.length > 0 || !result.content) {
			showToast(
				$t("Export failed: {error}", {
					error: result.errors[0] ?? "No output generated.",
				}),
				"error",
			);
			return;
		}

		const now = nowIso();
		const fileName =
			normalizeExportFileName(selectedProfile.fileName) || "sing-box-client.json";
		const nextProfile: ClientExportProfile = {
			...selectedProfile,
			fileName,
			lastGeneratedAt: now,
			updatedAt: now,
		};
		const stateForSync = {
			...$appState,
			clientExports: $appState.clientExports.map((profile) =>
				profile.id === nextProfile.id ? nextProfile : profile,
			),
		};
		const files = {
			[fileName]: { content: result.content },
			[WORKSPACE_FILE]: { content: exportSyncState(stateForSync) },
		};
		const response = $appState.activeGistId
			? await updateGist($authState.token, {
					gistId: $appState.activeGistId,
					files,
				})
			: await createGist($authState.token, {
					description: "SubMan client exports",
					isPublic: false,
					files,
				});
		const fileMeta = response.files.find((file) => file.filename === fileName);
		const lastPublishedUrl = toStableGistRawUrl(fileMeta?.rawUrl) ?? null;

		upsertClientExport({
			...nextProfile,
			lastPublishedAt: now,
			lastPublishedUrl,
			updatedAt: now,
		});
		appState.update((state) => ({ ...state, activeGistId: response.id }));
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

<div class="space-y-6">
	<section class="gh-box overflow-hidden">
		<div class="gh-section-header">
			<div class="flex min-w-0 items-center gap-3">
				<span class="app-brand-mark">
					<Octicon icon={fileCode} className="h-4 w-4" />
				</span>
				<div class="min-w-0">
					<h1 class="truncate text-base font-semibold text-fg-default">
						{$t("sing-box Client")}
					</h1>
					<p class="text-sm text-fg-muted">
						<span class="gh-counter">{profileCount}</span>
						{$t("profiles")}
					</p>
				</div>
			</div>
			<div class="gh-toolbar-group">
				<button
					class="gh-btn"
					type="button"
					on:click={copyPreview}
					disabled={!selectedProfile}
				>
					<Octicon icon={copy} className="h-4 w-4" />
					{$t("Copy")}
				</button>
				<button
					class="gh-btn"
					type="button"
					on:click={downloadPreview}
					disabled={!selectedProfile}
				>
					<Octicon icon={download} className="h-4 w-4" />
					{$t("Download")}
				</button>
				<button
					class="gh-btn gh-btn-primary"
					type="button"
					on:click={publishPreview}
					disabled={publishDisabled}
				>
					<Octicon icon={upload} className="h-4 w-4" />
					{publishing ? $t("Publishing...") : $t("Publish")}
				</button>
			</div>
		</div>

		<div class="space-y-4 p-4">
			{#if $appState.aggregates.length === 0}
				<p class="text-sm text-fg-muted">
					{$t("Create an Aggregate rule before exporting.")}
				</p>
			{:else if canCreateProfile}
				<button class="gh-btn gh-btn-primary" type="button" on:click={createProfile}>
					{$t("New profile")}
				</button>
			{/if}

			{#if $appState.clientExports.length > 0}
				<div class="max-w-xl space-y-2">
					<label class="gh-label" for="exports-profile">{$t("Export Profile")}</label>
					<select
						id="exports-profile"
						class="gh-select w-full"
						bind:value={selectedProfileId}
					>
						{#each $appState.clientExports as profile}
							<option value={profile.id}>{profile.name}</option>
						{/each}
					</select>
				</div>
			{/if}

			{#if selectedProfile}
				<div class="grid gap-4 md:grid-cols-2">
					<div class="space-y-2">
						<label class="gh-label" for="exports-name">{$t("Name")}</label>
						<input id="exports-name" class="gh-input" bind:value={draftName} />
					</div>
					<div class="space-y-2">
						<label class="gh-label" for="exports-file-name">{$t("File Name")}</label>
						<input
							id="exports-file-name"
							class="gh-input font-mono"
							bind:value={draftFileName}
						/>
					</div>
					<div class="space-y-2">
						<label class="gh-label" for="exports-source-rule">
							{$t("Source Aggregate Rule")}
						</label>
						<select
							id="exports-source-rule"
							class="gh-select w-full"
							bind:value={draftRuleId}
						>
							{#each $appState.aggregates as rule}
								<option value={rule.id}>{rule.name}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-2">
						<label class="gh-label" for="exports-listen-address">
							{$t("Listen Address")}
						</label>
						<input
							id="exports-listen-address"
							class="gh-input font-mono"
							bind:value={draftListenAddress}
						/>
					</div>
					<div class="space-y-2">
						<label class="gh-label" for="exports-listen-port">
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
						<label class="gh-label" for="exports-selector-tag">
							{$t("Selector Tag")}
						</label>
						<input
							id="exports-selector-tag"
							class="gh-input font-mono"
							bind:value={draftSelectorTag}
						/>
					</div>
					<div class="space-y-2">
						<label class="gh-label" for="exports-url-test-tag">
							{$t("URL Test Tag")}
						</label>
						<input
							id="exports-url-test-tag"
							class="gh-input font-mono"
							bind:value={draftUrlTestTag}
						/>
					</div>
					<label class="gh-checkbox-row mt-6">
						<input type="checkbox" bind:checked={draftIncludeExperimental} />
						<span>{$t("Include Experimental")}</span>
					</label>
				</div>

				<div class="flex flex-wrap items-center gap-2">
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
		</div>
	</section>

	<section class="gh-box overflow-hidden">
		<div class="gh-section-header">
			<h2 class="text-sm font-semibold text-fg-default">{$t("Summary")}</h2>
		</div>
		<div class="grid gap-3 p-4 sm:grid-cols-3">
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
		</div>
		{#if previewWarnings.length > 0 || previewErrors.length > 0}
			<div class="border-t border-border-default p-4">
				{#if previewWarnings.length > 0}
					<div class="mb-3">
						<h3 class="mb-2 text-xs font-semibold uppercase text-fg-muted">
							{$t("Warnings")}
						</h3>
						<ul class="space-y-1 text-sm text-attention-fg">
							{#each previewWarnings as warning}
								<li>{warning}</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if previewErrors.length > 0}
					<div>
						<h3 class="mb-2 text-xs font-semibold uppercase text-danger-fg">
							{$t("Errors")}
						</h3>
						<ul class="space-y-1 text-sm text-danger-fg">
							{#each previewErrors as error}
								<li>{error}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<section class="gh-box overflow-hidden">
		<div class="gh-section-header">
			<h2 class="text-sm font-semibold text-fg-default">{$t("Preview")}</h2>
		</div>
		<pre class="max-h-[36rem] overflow-auto p-4 text-xs text-fg-default">{previewContent || $t("Generate a preview to inspect config.json")}</pre>
	</section>
</div>
