<script lang="ts">
import { t } from "$lib/i18n";
import { appState } from "$lib/stores/app";
import Octicon from "$lib/components/Octicon.svelte";
import { copy, download, fileCode, upload } from "$lib/octicons";

let selectedRuleId = "";

$: firstRule = $appState.aggregates[0] ?? null;
$: {
	const selectedRuleExists = $appState.aggregates.some((rule) => rule.id === selectedRuleId);
	if (firstRule && !selectedRuleExists) selectedRuleId = firstRule.id;
	if (!firstRule) selectedRuleId = "";
}
$: selectedRule = $appState.aggregates.find((rule) => rule.id === selectedRuleId) ?? null;
$: profileCount = $appState.clientExports.length;
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
				<button class="gh-btn" type="button" disabled={!selectedRule}>
					<Octicon icon={copy} className="h-4 w-4" />
					{$t("Copy")}
				</button>
				<button class="gh-btn" type="button" disabled={!selectedRule}>
					<Octicon icon={download} className="h-4 w-4" />
					{$t("Download")}
				</button>
				<button class="gh-btn gh-btn-primary" type="button" disabled={!selectedRule}>
					<Octicon icon={upload} className="h-4 w-4" />
					{$t("Publish")}
				</button>
			</div>
		</div>

		<div class="p-4">
			<div class="max-w-xl space-y-2">
				<label class="gh-label" for="exports-source-rule">
					{$t("Source Aggregate Rule")}
				</label>
				<select
					id="exports-source-rule"
					class="gh-select w-full"
					bind:value={selectedRuleId}
				>
					{#each $appState.aggregates as rule}
						<option value={rule.id}>{rule.name}</option>
					{/each}
				</select>
			</div>

			<div class="mt-4 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
				<span class="badge">{$t("Workspace")}</span>
				<span>{selectedRule ? selectedRule.name : $t("Select an aggregate rule")}</span>
			</div>
		</div>
	</section>
</div>
