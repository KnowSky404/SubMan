<script lang="ts">
import { onMount } from "svelte";
import { tooltip } from "$lib/actions/tooltip";
import CopyButton from "$lib/components/CopyButton.svelte";
import Octicon from "$lib/components/Octicon.svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import { getGist } from "$lib/gist";
import { t } from "$lib/i18n";
import type { GistMeta } from "$lib/models";
import {
	alert,
	code,
	file as fileIcon,
	linkExternal,
	shieldCheck,
	sync,
} from "$lib/octicons";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { showToast } from "$lib/stores/toast";
import { cn } from "$lib/utils/cn";
import { WORKSPACE_RESERVED_FILE_NAMES } from "$lib/workspace-document";
import {
	classifyWorkspaceFile,
	getWorkspaceBootstrapStatus,
	type WorkspaceFileKind,
} from "$lib/workspace-file-inventory";
import { requireWorkspaceIdentity } from "$lib/workspace-identity";
import {
	getBrowserWorkspaceBinding,
	initializeBrowserWorkspacePersistence,
} from "$lib/workspace-persistence-browser";

let workspace: GistMeta | null = null;
let loading = false;
$: workspaceFileCount = workspace?.files.length ?? 0;
$: bootstrapStatus = getWorkspaceBootstrapStatus(
	workspace?.files.map((file) => file.filename) ?? [],
);

function setStatus(
	message: string,
	type: "success" | "info" | "error" = "success",
) {
	showToast(message, type);
}

function fileKindLabel(kind: WorkspaceFileKind): string {
	switch (kind) {
		case "workspace-config":
			return $t("Workspace Config");
		case "v1-migration-backup":
			return $t("V1 Migration Backup");
		case "bootstrap-marker":
			return $t("Bootstrap Marker");
		case "managed-output":
			return $t("Managed Output");
		case "external-file":
			return $t("External File");
	}
}

function workspaceFailureMessage(error: unknown, fallback: string): string {
	const message = error instanceof Error ? error.message : "";
	if (message.includes("migration_backup_conflict")) {
		return $t(
			"The immutable V1 migration backup does not match subman.json. Restore the matching backup before retrying.",
		);
	}
	if (message.includes("invalid_bootstrap_marker")) {
		return $t(
			"The Workspace bootstrap marker is invalid. Repair or remove it in GitHub before resuming.",
		);
	}
	if (message.includes("Workspace identity requires repair")) {
		return $t("Workspace identity requires repair before this action.");
	}
	return $t(fallback);
}

async function refreshWorkspace() {
	const token = $authState.token;
	if (!token) return;

	loading = true;
	try {
		await initializeBrowserWorkspacePersistence();
		const identity = requireWorkspaceIdentity(
			$appState,
			getBrowserWorkspaceBinding(),
		);
		workspace = await getGist(token, identity.gistId);
	} catch (error) {
		setStatus(workspaceFailureMessage(error, "Failed to fetch"), "error");
	} finally {
		loading = false;
	}
}

onMount(() => {
	if ($authState.token) void refreshWorkspace();
});
</script>

<svelte:head>
	<title>{$t("Gists")} - SubMan</title>
</svelte:head>

<div class="gh-page">
 <PageHeader title={$t("Gists")} description={$t("Read-only cloud files. Manage publications in Aggregation or Client Exports.")}>
			{#if $appState.activeGistId}
				<a href={`https://gist.github.com/${$appState.activeGistId}`} target="_blank" rel="noreferrer" class="gh-icon-button" aria-label={$t("View on GitHub")} title={$t("View on GitHub")} use:tooltip={$t("View on GitHub")}><Octicon icon={linkExternal} className="h-4 w-4" /></a>
			{/if}
			<button type="button" class="gh-btn gh-btn-primary" on:click={refreshWorkspace} disabled={loading}>
				<Octicon icon={sync} className={cn("h-4 w-4", loading && "animate-spin")} />
				{loading ? $t("Refreshing...") : $t("Refresh")}
			</button>
 </PageHeader>

	<!-- File List -->
	<div class="gh-layout-main">
		{#if bootstrapStatus}
			<div class={cn("gh-alert mb-4", bootstrapStatus === "stale" ? "gh-alert-attention" : "gh-alert-danger")}>
				<Octicon icon={alert} className="mt-0.5 h-4 w-4 shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold">{bootstrapStatus === "stale" ? $t("Stale marker") : bootstrapStatus === "incomplete" ? $t("Initialization incomplete") : $t("Invalid bootstrap workspace")}</p>
					<p class="text-xs text-fg-muted">{bootstrapStatus === "stale" ? $t("The Workspace is valid, but its bootstrap marker was not removed.") : bootstrapStatus === "incomplete" ? $t("Resume setup to create the Workspace configuration atomically.") : $t("Bootstrap initialization requires the marker to be the only file.")}</p>
				</div>
				{#if bootstrapStatus === "incomplete"}
					<a href="/auth" class="gh-btn gh-btn-primary gh-btn-sm">{$t("Settings")}</a>
				{/if}
			</div>
		{/if}
		<div class="gh-box shadow-sm">
			<div class="gh-box-header">
				<div class="flex items-center gap-2">
					<Octicon icon={code} className="h-4 w-4" />
					<span>{$t("Repository Files")}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="gh-label gh-label-muted">{$t("Read-only")}</span>
					<span class="badge">{workspaceFileCount}</span>
				</div>
			</div>

			{#if loading && !workspace}
				<div class="blankslate border-none">
					<Octicon icon={sync} className="mb-3 h-10 w-10 animate-spin text-accent-fg" />
					<h3 class="text-lg font-bold">{$t("Loading workspace files...")}</h3>
					<p class="text-sm text-fg-muted">{$t("Fetching the active gist from GitHub.")}</p>
				</div>
			{:else if !workspace}
				<div class="blankslate border-none">
					<Octicon icon={sync} className="mb-3 h-10 w-10 text-fg-subtle opacity-20" />
					<p class="text-fg-muted">{$t("Refresh to load files.")}</p>
				</div>
			{:else}
				<div class="gh-list-header gh-file-list-header">
					<span>{$t("Name")}</span>
					<span>{$t("Kind")}</span>
					<span class="text-right">{$t("Size")}</span>
					<span class="text-right">{$t("Actions")}</span>
				</div>
				{#each workspace.files as gistFile}
					{@const fileKind = classifyWorkspaceFile(gistFile.filename, $appState)}
					<div class="gh-box-row group">
						<div class="gh-file-list-row flex flex-col gap-2">
							<div class="gh-row-main">
								{#if WORKSPACE_RESERVED_FILE_NAMES.has(gistFile.filename)}
									<Octicon icon={shieldCheck} className="mt-0.5 h-4 w-4 shrink-0 text-accent-fg" />
								{:else}
									<Octicon icon={fileIcon} className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
								{/if}
								<div class="min-w-0 space-y-1">
									<div class="flex items-center gap-2 min-w-0">
										{#if gistFile.rawUrl}
											<a href={gistFile.rawUrl} target="_blank" rel="noreferrer" class="gh-row-title">{gistFile.filename}<span class="sr-only"> · {$t("Open Raw")}</span></a>
										{:else}
											<span class="gh-static-title">{gistFile.filename}</span>
										{/if}
									</div>
									<div class="gh-list-meta">
										{#if gistFile.rawUrl}
											<span class="gh-list-meta-code">{gistFile.rawUrl.replace(/^https?:\/\//, "")}</span>
										{:else}
											<span>{$t("No raw URL")}</span>
										{/if}
									</div>
								</div>
							</div>

							<div class="sm:justify-self-start">
								<span class={cn("gh-label gh-label-muted", fileKind === "workspace-config" ? "badge-success" : "")}>
									{fileKindLabel(fileKind)}
								</span>
							</div>

							<div class="text-xs text-fg-muted sm:text-right">
								{gistFile.size} bytes
							</div>

							<div class="gh-row-actions gh-btn-group">
								{#if gistFile.rawUrl}
									<CopyButton value={gistFile.rawUrl} label={$t("Copy Raw URL")} />
									<a href={gistFile.rawUrl} target="_blank" rel="noreferrer" class="gh-btn gh-btn-sm" title={$t("Open Raw")} use:tooltip={$t("Open Raw")} aria-label={$t("Open Raw")}><Octicon icon={linkExternal} className="h-3.5 w-3.5" /></a>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
