<script lang="ts">
import { onMount } from "svelte";
import type { GistMeta } from "$lib/models";
import { t } from "$lib/i18n";
import { appState } from "$lib/stores/app";
import { authState } from "$lib/stores/auth";
import { requestConfirm } from "$lib/stores/confirm";
import { showToast } from "$lib/stores/toast";
import { getGist, updateGist } from "$lib/gist";
import { WORKSPACE_FILE } from "$lib/workspace";
import { cn } from "$lib/utils/cn";
import Octicon from "$lib/components/Octicon.svelte";
import {
	code,
	copy,
	database,
	file,
	linkExternal,
	repo,
	shieldCheck,
	sync,
	trash,
} from "$lib/octicons";

let workspace: GistMeta | null = null;
let loading = false;
let deleting = false;

function setStatus(
	message: string,
	type: "success" | "info" | "error" = "success",
) {
	showToast(message, type);
}

async function refreshWorkspace() {
	const token = $authState.token;
	const gistId = $appState.activeGistId;
	if (!token || !gistId) return;

	loading = true;
	try {
		workspace = await getGist(token, gistId);
		setStatus($t("Refreshed"), "success");
	} catch (err) {
		setStatus($t("Failed to fetch"), "error");
	} finally {
		loading = false;
	}
}

onMount(() => {
	if ($authState.token && $appState.activeGistId) void refreshWorkspace();
});
$: workspaceFileCount = workspace?.files.length ?? 0;

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
	if (!token || !gistId || filename === WORKSPACE_FILE) return;

	const confirmed = await requestConfirm({
		title: $t("Delete File"),
		message: $t("Delete {filename} forever?", { filename }),
		confirmText: $t("Delete"),
		danger: true,
	});
	if (!confirmed) return;

	deleting = true;
	try {
		workspace = await updateGist(token, {
			gistId,
			files: { [filename]: null },
		});
		setStatus($t("Deleted file successfully"), "success");
	} catch (err) {
		setStatus($t("Delete failed"), "error");
	} finally {
		deleting = false;
	}
}
</script>

<div class="flex flex-col gap-6">
	<div class="gh-page-header">
		<div class="flex items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<Octicon icon={repo} className="h-6 w-6 text-fg-muted" />
				<div>
					<h1 class="text-[2rem] font-semibold leading-tight">{$t("Gist Files")}</h1>
					<p class="gh-page-subtitle">{$t("Inspect the active workspace gist and copy raw file URLs.")}</p>
					<div class="gh-page-meta">
						<span class="gh-page-meta-item">
							<Octicon icon={repo} className="h-3.5 w-3.5" />
							{$t("{count} files", { count: workspaceFileCount })}
						</span>
						{#if $appState.activeGistId}
							<span class="gh-page-meta-item">
								<Octicon icon={shieldCheck} className="h-3.5 w-3.5" />
								<span class="gh-page-meta-item-code">{$appState.activeGistId}</span>
							</span>
						{/if}
					</div>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<button type="button" class="gh-btn" on:click={refreshWorkspace} disabled={loading}>
					<Octicon icon={sync} className={cn("h-4 w-4", loading && "animate-spin")} />
					{$t("Refresh")}
				</button>
			</div>
		</div>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
		<!-- Workspace Info -->
		<div class="lg:col-span-1 flex flex-col gap-6">
			<div class="gh-box">
				<div class="gh-box-header text-xs">
					<span>{$t("Active Gist")}</span>
					{#if $appState.activeGistId}
						<span class="badge">1</span>
					{/if}
				</div>
				<div class="p-4 bg-canvas-default flex flex-col gap-3">
					{#if $appState.activeGistId}
						<code class="text-[10px] font-mono break-all bg-canvas-subtle p-2 rounded border border-border-default">{$appState.activeGistId}</code>
						<a href={`https://gist.github.com/${$appState.activeGistId}`} target="_blank" class="gh-btn gh-btn-sm w-full"><Octicon icon={linkExternal} className="h-3 w-3" />{$t("View on GitHub")}</a>
					{:else}
						<p class="text-xs text-fg-muted italic">{$t("No active gist")}</p>
					{/if}
				</div>
			</div>

			<div class="blankslate p-4 py-6">
				<Octicon icon={database} className="mb-2 h-8 w-8 text-fg-subtle" />
				<p class="text-xs text-fg-muted">{$t("Published files are written back into this gist.")}</p>
			</div>
		</div>

		<!-- File List -->
		<div class="lg:col-span-3 flex flex-col gap-4">
			<div class="gh-box shadow-sm">
				<div class="gh-box-header">
					<div class="flex items-center gap-2">
						<Octicon icon={code} className="h-4 w-4" />
						<span>{$t("Repository Files")}</span>
					</div>
					<span class="badge">{workspaceFileCount}</span>
				</div>

				{#if !workspace}
					<div class="blankslate border-none">
						<Octicon icon={sync} className="mb-3 h-10 w-10 text-fg-subtle opacity-20" />
						<p class="text-fg-muted">{$t("Refresh to load files.")}</p>
					</div>
				{:else}
					{#each workspace.files as file}
						<div class="gh-box-row flex items-center justify-between gap-4 group">
							<div class="flex items-center gap-3 min-w-0">
								{#if file.filename === WORKSPACE_FILE}
									<Octicon icon={shieldCheck} className="h-4 w-4 text-accent-fg" />
								{:else}
									<Octicon icon={file} className="h-4 w-4 text-fg-muted" />
								{/if}
								<div class="flex flex-col min-w-0">
									<div class="flex items-center gap-2 min-w-0">
										<span class="truncate text-sm font-semibold text-accent-fg hover:underline cursor-pointer">{file.filename}</span>
										{#if file.filename === WORKSPACE_FILE}
											<span class="badge badge-success">Config</span>
										{/if}
									</div>
									<span class="text-[11px] text-fg-subtle">{file.size} bytes</span>
								</div>
							</div>
							
							<div class="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
								{#if file.rawUrl}
									<button class="gh-btn gh-btn-sm" on:click={() => copyLink(file.rawUrl)} title={$t("Copy Raw URL")}><Octicon icon={copy} className="h-3.5 w-3.5" /></button>
									<a href={file.rawUrl} target="_blank" class="gh-btn gh-btn-sm" title={$t("Open Raw")}><Octicon icon={linkExternal} className="h-3.5 w-3.5" /></a>
								{/if}
								{#if file.filename !== WORKSPACE_FILE}
									<button class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => deleteFile(file.filename)} disabled={deleting} title={$t("Delete")}><Octicon icon={trash} className="h-3.5 w-3.5" /></button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>
