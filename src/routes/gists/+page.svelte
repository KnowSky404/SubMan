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
	file as fileIcon,
	linkExternal,
	repo,
	shieldCheck,
	sync,
	trash,
} from "$lib/octicons";

let workspace: GistMeta | null = null;
let loading = false;
let deleting = false;
$: workspaceFileCount = workspace?.files.length ?? 0;
$: workspaceUpdatedText = workspace?.updatedAt
	? new Intl.DateTimeFormat(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}).format(new Date(workspace.updatedAt))
	: null;

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
					<div class="gh-list-header hidden sm:grid sm:grid-cols-[minmax(0,1.6fr)_120px_96px_auto]">
						<span>{$t("Name")}</span>
						<span>{$t("Kind")}</span>
						<span class="text-right">{$t("Size")}</span>
						<span class="text-right">{$t("Actions")}</span>
					</div>
					{#each workspace.files as gistFile}
						<div class="gh-box-row group">
							<div class="flex flex-col gap-2 sm:grid sm:grid-cols-[minmax(0,1.6fr)_120px_96px_auto] sm:items-center sm:gap-4">
								<div class="gh-row-main">
									{#if gistFile.filename === WORKSPACE_FILE}
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
									<span class={cn("gh-label gh-label-muted", gistFile.filename === WORKSPACE_FILE ? "badge-success" : "")}>
										{gistFile.filename === WORKSPACE_FILE ? $t("Config") : $t("Published")}
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
									{#if gistFile.filename !== WORKSPACE_FILE}
										<button class="gh-btn gh-btn-sm gh-btn-danger" on:click={() => deleteFile(gistFile.filename)} disabled={deleting} title={$t("Delete")}><Octicon icon={trash} className="h-3.5 w-3.5" /></button>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>
