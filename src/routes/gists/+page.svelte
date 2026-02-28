<script lang="ts">
	import type { GistMeta } from "$lib/models";
	import { t } from "$lib/i18n";
	import { appState } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import { getGist, updateGist } from "$lib/gist";
	import { nowIso } from "$lib/utils/time";
	import { WORKSPACE_FILE } from "$lib/workspace";

	let workspace: GistMeta | null = null;
	let loading = false;
	let deleting = false;
	let error: string | null = null;
	let status: string | null = null;
	let managedFiles = new Set<string>();

	$: managedFiles = new Set(
		$appState.publishTargets
			.map((target) => target.fileName.trim())
			.filter(Boolean)
	);

	async function refreshWorkspace() {
		error = null;
		status = null;
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token) {
			error = $t("Missing GitHub token. Configure workspace first.");
			return;
		}
		if (!gistId) {
			error = $t("Workspace gist not set. Configure workspace first.");
			return;
		}

		loading = true;
		try {
			workspace = await getGist(token, gistId);
			status = $t("Workspace gist refreshed.");
		} catch (err) {
			error = err instanceof Error ? err.message : $t("Failed to fetch workspace gist.");
		} finally {
			loading = false;
		}
	}

	async function copyLink(url?: string) {
		status = null;
		if (!url) {
			status = $t("Raw link unavailable.");
			return;
		}
		try {
			await navigator.clipboard.writeText(url);
			status = $t("Link copied.");
		} catch {
			status = $t("Copy failed.");
		}
	}

	function isConfigFile(filename: string) {
		return filename === WORKSPACE_FILE;
	}

	function isManagedOutput(filename: string) {
		return managedFiles.has(filename);
	}

	function canDelete(filename: string) {
		return !isConfigFile(filename);
	}

	async function deleteWorkspaceFile(filename: string) {
		error = null;
		status = null;
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId) {
			error = $t("Missing workspace authorization.");
			return;
		}
		if (!canDelete(filename)) {
			status = $t("{file} is protected and cannot be deleted.", { file: WORKSPACE_FILE });
			return;
		}

		const ok = confirm(
			$t("Delete {filename} from workspace gist? This cannot be undone.", { filename })
		);
		if (!ok) {
			return;
		}

		deleting = true;
		try {
			workspace = await updateGist(token, {
				gistId,
				files: {
					[filename]: null
				}
			});
			const updatedAt = nowIso();
			appState.update((state) => ({
				...state,
				publishTargets: state.publishTargets.map((target) =>
					target.fileName === filename
						? {
								...target,
								lastPublishedAt: null,
								lastPublishedUrl: null,
								updatedAt
							}
						: target
				),
				lastUpdated: updatedAt
			}));
			status = $t("Deleted {filename}.", { filename });
		} catch (err) {
			error = err instanceof Error ? err.message : $t("Failed to delete file.");
		} finally {
			deleting = false;
		}
	}

	async function cleanWorkspaceFiles() {
		error = null;
		status = null;
		const token = $authState.token;
		const gistId = $appState.activeGistId;
		if (!token || !gistId) {
			error = $t("Missing workspace authorization.");
			return;
		}
		if (!workspace) {
			status = $t("Refresh workspace first.");
			return;
		}

		const filesToDelete = workspace.files
			.map((file) => file.filename)
			.filter((name) => !isConfigFile(name));
		if (filesToDelete.length === 0) {
			status = $t("No removable files found.");
			return;
		}

		const ok = confirm(
			$t("Delete {count} workspace file(s) except {file}? This cannot be undone.", {
				count: filesToDelete.length,
				file: WORKSPACE_FILE
			})
		);
		if (!ok) {
			return;
		}

		const files = Object.fromEntries(filesToDelete.map((name) => [name, null]));
		deleting = true;
		try {
			workspace = await updateGist(token, {
				gistId,
				files
			});
			const removed = new Set(filesToDelete);
			const updatedAt = nowIso();
			appState.update((state) => ({
				...state,
				publishTargets: state.publishTargets.map((target) =>
					removed.has(target.fileName)
						? {
								...target,
								lastPublishedAt: null,
								lastPublishedUrl: null,
								updatedAt
							}
						: target
				),
				lastUpdated: updatedAt
			}));
			status = $t("Deleted {count} file(s).", { count: filesToDelete.length });
		} catch (err) {
			error = err instanceof Error ? err.message : $t("Failed to clean files.");
		} finally {
			deleting = false;
		}
	}
</script>

	<section class="flex flex-col gap-6">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-semibold">{$t("Gist Workspace")}</h1>
				<p class="mt-2 text-sm text-slate-300">
					{$t("View published files inside your workspace gist.")}
				</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<a class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold" href="/auth">
					{$t("Open Workspace")}
				</a>
			<button
				class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
					on:click={refreshWorkspace}
					disabled={loading}
				>
					{loading ? $t("Loading...") : $t("Refresh")}
				</button>
			</div>
		</div>

	{#if error}
		<div class="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
			{error}
		</div>
	{/if}

	{#if status}
		<p class="text-xs text-slate-300">{status}</p>
	{/if}

		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold">{$t("Workspace Files")}</h2>
				<span class="text-xs text-slate-400">
					{$appState.activeGistId ? $appState.activeGistId : $t("No workspace")}
				</span>
			</div>
			<p class="mt-2 text-xs text-slate-400">
				{$t("{file} is protected. All other workspace files can be deleted.", { file: WORKSPACE_FILE })}
			</p>
			<div class="mt-3">
			<button
				class="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold disabled:opacity-50"
					on:click={cleanWorkspaceFiles}
					disabled={deleting}
				>
					{deleting
						? $t("Working")
						: $t("Clean All Except {file}", { file: WORKSPACE_FILE })}
				</button>
			</div>
			<div class="mt-4 grid gap-3">
				{#if !workspace}
					<p class="text-sm text-slate-400">{$t("Refresh to load files.")}</p>
				{:else if workspace.files.length === 0}
					<p class="text-sm text-slate-400">{$t("No files in workspace.")}</p>
				{:else}
				{#each workspace.files as file}
					<div class="rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<p class="text-sm font-semibold">{file.filename}</p>
								<p class="text-xs text-slate-400">{file.size} bytes</p>
									{#if isConfigFile(file.filename)}
										<p class="text-[11px] text-sky-300">{$t("Workspace config")}</p>
									{:else if isManagedOutput(file.filename)}
										<p class="text-[11px] text-emerald-300">{$t("Managed output")}</p>
									{:else}
										<p class="text-[11px] text-slate-500">{$t("Unmanaged file")}</p>
									{/if}
								</div>
								<div class="flex items-center gap-2 text-xs">
								{#if file.rawUrl}
									<a
										class="text-slate-300 hover:text-white"
										href={file.rawUrl}
											target="_blank"
											rel="noreferrer"
										>
											{$t("Open")}
										</a>
									{/if}
									<button
										class="rounded-full border border-slate-700 px-3 py-1"
										on:click={() => copyLink(file.rawUrl)}
									>
										{$t("Copy")}
									</button>
								<button
									class="rounded-full border border-rose-700 px-3 py-1 text-rose-200 disabled:opacity-50"
										on:click={() => deleteWorkspaceFile(file.filename)}
										disabled={!canDelete(file.filename) || deleting}
									>
										{$t("Delete")}
									</button>
								</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>
