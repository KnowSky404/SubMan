<script lang="ts">
import { onMount } from "svelte";
import Octicon from "$lib/components/Octicon.svelte";
import { getGist } from "$lib/gist";
import { t } from "$lib/i18n";
import type { AppState, GistMeta } from "$lib/models";
import {
	alert,
	code,
	copy,
	database,
	file as fileIcon,
	linkExternal,
	shieldCheck,
	sync,
	trash,
} from "$lib/octicons";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { requestConfirm } from "$lib/stores/confirm";
import { showToast } from "$lib/stores/toast";
import { cn } from "$lib/utils/cn";
import {
	readBrowserWorkspaceSnapshot,
	reconcileBrowserWorkspace,
	submitBrowserWorkspaceMutation,
} from "$lib/workspace-browser-session-v2";
import {
	WORKSPACE_BOOTSTRAP_FILE_NAME,
	WORKSPACE_RESERVED_FILE_NAMES,
} from "$lib/workspace-document";
import {
	classifyWorkspaceFile,
	getWorkspaceBootstrapStatus,
	type WorkspaceFileKind,
} from "$lib/workspace-file-inventory";
import { requireWorkspaceIdentity } from "$lib/workspace-identity";
import { WorkspaceMutationQueue } from "$lib/workspace-mutation-queue";
import { WorkspaceV2StateStore } from "$lib/workspace-v2-state";

let workspace: GistMeta | null = null;
let loading = false;
let deleting = false;
let lastRefreshedAt: string | null = null;
$: workspaceFileCount = workspace?.files.length ?? 0;
$: bootstrapStatus = getWorkspaceBootstrapStatus(
	workspace?.files.map((file) => file.filename) ?? [],
);
$: workspaceUpdatedText = workspace?.updatedAt
	? new Intl.DateTimeFormat(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(workspace.updatedAt))
	: null;
$: lastRefreshedText = lastRefreshedAt
	? new Intl.DateTimeFormat(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		}).format(new Date(lastRefreshedAt))
	: null;

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

function mutationDependencies() {
	return {
		queue: new WorkspaceMutationQueue(),
		stateStore: new WorkspaceV2StateStore(),
		getState: () => $appState,
		setState: (state: AppState) => appState.set(state),
	};
}

async function refreshWorkspace() {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	if (!token || !gistId) return;

	loading = true;
	try {
		workspace = await getGist(token, gistId);
		lastRefreshedAt = new Date().toISOString();
	} catch (err) {
		setStatus($t("Failed to fetch"), "error");
	} finally {
		loading = false;
	}
}

onMount(() => {
	if ($authState.token && $appState.activeGistId) void refreshWorkspace();
});

async function copyLink(url?: string) {
	if (!url) return;
	try {
		await navigator.clipboard.writeText(url);
		setStatus($t("Copied to clipboard"));
	} catch {
		setStatus($t("Copy failed"), "error");
	}
}

async function deleteFile(filename: string) {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	if (!token || !gistId || WORKSPACE_RESERVED_FILE_NAMES.has(filename)) return;

	const confirmed = await requestConfirm({
		title: $t("Delete File"),
		message: $t("Delete {filename} forever?", { filename }),
		confirmText: $t("Delete"),
		danger: true,
	});
	if (!confirmed) return;

	deleting = true;
	try {
		await submitBrowserWorkspaceMutation(
			{
				token,
				kind: "output.delete",
				payload: { fileName: filename },
			},
			mutationDependencies(),
		);
		await refreshWorkspace();
		setStatus($t("Deleted file successfully"), "success");
	} catch (err) {
		setStatus($t("Delete failed"), "error");
	} finally {
		deleting = false;
	}
}

async function cleanupBootstrapMarker() {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	if (!token || !gistId || bootstrapStatus !== "stale") return;
	const confirmed = await requestConfirm({
		title: $t("Clean Up Bootstrap Marker"),
		message: $t(
			"Remove the stale bootstrap marker? Workspace config and the immutable V1 backup will be preserved.",
		),
		confirmText: $t("Remove Stale Marker"),
		danger: true,
	});
	if (!confirmed) return;

	deleting = true;
	try {
		await submitBrowserWorkspaceMutation(
			{
				token,
				kind: "workspace.bootstrap.cleanup",
				payload: {},
			},
			mutationDependencies(),
		);
		await refreshWorkspace();
		setStatus($t("Stale bootstrap marker removed"), "success");
	} catch (error) {
		setStatus(
			workspaceFailureMessage(error, "Bootstrap cleanup failed"),
			"error",
		);
	} finally {
		deleting = false;
	}
}

async function resumeBootstrapInitialization() {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	if (!token || !gistId || bootstrapStatus !== "incomplete") return;
	const confirmed = await requestConfirm({
		title: $t("Resume Workspace Initialization"),
		message: $t(
			"Create subman.json from the current local business data and remove the bootstrap marker?",
		),
		confirmText: $t("Resume"),
	});
	if (!confirmed) return;

	deleting = true;
	try {
		requireWorkspaceIdentity($appState, new WorkspaceV2StateStore().read());
		const gist = workspace ?? (await getGist(token, gistId));
		const snapshot = await readBrowserWorkspaceSnapshot(token, gist, $appState);
		if (snapshot.origin !== "bootstrap") {
			throw new Error("Workspace bootstrap state changed");
		}
		await reconcileBrowserWorkspace(
			{
				token,
				gistId,
				baseline: snapshot.document,
				resolvedState: $appState,
				syncMode: "automatic",
			},
			mutationDependencies(),
		);
		await refreshWorkspace();
		setStatus($t("Workspace initialization completed"), "success");
	} catch (error) {
		setStatus(
			workspaceFailureMessage(error, "Workspace initialization failed"),
			"error",
		);
	} finally {
		deleting = false;
	}
}
</script>

<div class="gh-page">
	<header class="gh-page-header">
		<div class="gh-page-heading">
			<h1 class="gh-page-title">{$t("Gists")}</h1>
			<p class="gh-page-subtitle">
				{$t("Inspect workspace files, copy raw links, and manage published outputs in the active gist.")}
			</p>
			<div class="gh-page-meta">
				<span class="gh-page-meta-item">{$t("{count} files", { count: workspaceFileCount })}</span>
				{#if workspaceUpdatedText}
					<span class="gh-page-meta-item">{$t("Updated {time}", { time: workspaceUpdatedText })}</span>
				{/if}
				{#if lastRefreshedText}
					<span class="gh-page-meta-item">{$t("Last refreshed {time}", { time: lastRefreshedText })}</span>
				{/if}
			</div>
		</div>
		<div class="gh-page-actions">
			<button type="button" class="gh-btn gh-btn-primary" on:click={refreshWorkspace} disabled={loading}>
				<Octicon icon={sync} className={cn("h-4 w-4", loading && "animate-spin")} />
				{loading ? $t("Refreshing...") : $t("Refresh")}
			</button>
		</div>
	</header>

	<div class="gh-layout-sidebar lg:grid-cols-[minmax(0,1fr)_296px]">
		<!-- File List -->
		<div class="gh-layout-main">
			{#if bootstrapStatus}
				<div class={cn("gh-alert mb-4", bootstrapStatus === "stale" ? "gh-alert-attention" : "gh-alert-danger")}>
					<Octicon icon={alert} className="mt-0.5 h-4 w-4 shrink-0" />
					<div class="min-w-0 flex-1">
						<p class="text-sm font-semibold">{bootstrapStatus === "stale" ? $t("Stale marker") : bootstrapStatus === "incomplete" ? $t("Initialization incomplete") : $t("Invalid bootstrap workspace")}</p>
						<p class="text-xs text-fg-muted">{bootstrapStatus === "stale" ? $t("The Workspace is valid, but its bootstrap marker was not removed.") : bootstrapStatus === "incomplete" ? $t("Resume setup to create the Workspace configuration atomically.") : $t("Bootstrap initialization requires the marker to be the only file.")}</p>
					</div>
					{#if bootstrapStatus === "stale"}
						<button type="button" class="gh-btn gh-btn-sm" on:click={cleanupBootstrapMarker} disabled={deleting}>{$t("Clean Up")}</button>
					{:else if bootstrapStatus === "incomplete"}
						<button type="button" class="gh-btn gh-btn-primary gh-btn-sm" on:click={resumeBootstrapInitialization} disabled={deleting}>{$t("Resume")}</button>
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
						<span class="badge">{workspaceFileCount}</span>
						<button type="button" class="gh-btn gh-btn-sm" on:click={refreshWorkspace} disabled={loading}>
							<Octicon icon={sync} className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
							{loading ? $t("Refreshing...") : $t("Refresh")}
						</button>
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
					<div class="gh-list-header hidden sm:grid sm:grid-cols-[minmax(0,1.6fr)_120px_96px_auto]">
						<span>{$t("Name")}</span>
						<span>{$t("Kind")}</span>
						<span class="text-right">{$t("Size")}</span>
						<span class="text-right">{$t("Actions")}</span>
					</div>
					{#each workspace.files as gistFile}
						{@const fileKind = classifyWorkspaceFile(gistFile.filename, $appState)}
						<div class="gh-box-row group">
							<div class="flex flex-col gap-2 sm:grid sm:grid-cols-[minmax(0,1.6fr)_120px_96px_auto] sm:items-center sm:gap-4">
								<div class="gh-row-main">
									{#if WORKSPACE_RESERVED_FILE_NAMES.has(gistFile.filename)}
										<Octicon icon={shieldCheck} className="mt-0.5 h-4 w-4 shrink-0 text-accent-fg" />
									{:else}
										<Octicon icon={fileIcon} className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
									{/if}
									<div class="min-w-0 space-y-1">
										<div class="flex items-center gap-2 min-w-0">
											<span class="gh-row-title cursor-pointer">{gistFile.filename}</span>
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

								<div class="text-[11px] text-fg-subtle sm:text-right">
									{gistFile.size} bytes
								</div>

								<div class="gh-row-actions gh-btn-group">
									{#if gistFile.rawUrl}
										<button class="gh-btn gh-btn-sm" on:click={() => copyLink(gistFile.rawUrl)} title={$t("Copy Raw URL")}><Octicon icon={copy} className="h-3.5 w-3.5" /></button>
										<a href={gistFile.rawUrl} target="_blank" class="gh-btn gh-btn-sm" title={$t("Open Raw")}><Octicon icon={linkExternal} className="h-3.5 w-3.5" /></a>
									{/if}
									{#if !WORKSPACE_RESERVED_FILE_NAMES.has(gistFile.filename)}
										<button class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => deleteFile(gistFile.filename)} disabled={deleting} title={$t("Delete")}><Octicon icon={trash} className="h-3.5 w-3.5" /></button>
									{:else if gistFile.filename === WORKSPACE_BOOTSTRAP_FILE_NAME && bootstrapStatus === "stale"}
										<button class="gh-btn gh-btn-sm" on:click={cleanupBootstrapMarker} disabled={deleting} title={$t("Clean Up")}><Octicon icon={trash} className="h-3.5 w-3.5" /></button>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Workspace Info -->
		<aside class="gh-layout-aside">
			<div class="gh-box">
				<div class="gh-box-header text-xs">
					<span>{$t("Active Gist")}</span>
					{#if $appState.activeGistId}
						<span class="badge">1</span>
					{/if}
				</div>
				<div class="gh-section-body">
					{#if $appState.activeGistId}
						<code class="gh-code-block break-all">{$appState.activeGistId}</code>
						<a href={`https://gist.github.com/${$appState.activeGistId}`} target="_blank" class="gh-btn gh-btn-sm w-full"><Octicon icon={linkExternal} className="h-3 w-3" />{$t("View on GitHub")}</a>
					{:else}
						<p class="gh-form-caption">{$t("No active gist")}</p>
					{/if}
				</div>
			</div>

			<div class="blankslate p-4 py-6">
				<Octicon icon={database} className="mb-2 h-8 w-8 text-fg-subtle" />
				<p class="text-xs text-fg-muted">{$t("Published files are written back into this gist.")}</p>
			</div>
		</aside>
	</div>
</div>
