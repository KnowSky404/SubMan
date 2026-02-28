<script lang="ts">
	import type { GistMeta } from "$lib/models";
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
			error = "Missing GitHub token. Configure workspace first.";
			return;
		}
		if (!gistId) {
			error = "Workspace gist not set. Configure workspace first.";
			return;
		}

		loading = true;
		try {
			workspace = await getGist(token, gistId);
			status = "Workspace gist refreshed.";
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to fetch workspace gist.";
		} finally {
			loading = false;
		}
	}

	async function copyLink(url?: string) {
		status = null;
		if (!url) {
			status = "Raw link unavailable.";
			return;
		}
		try {
			await navigator.clipboard.writeText(url);
			status = "Link copied.";
		} catch {
			status = "Copy failed.";
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
			error = "Missing workspace authorization.";
			return;
		}
		if (!canDelete(filename)) {
			status = `${WORKSPACE_FILE} is protected and cannot be deleted.`;
			return;
		}

		const ok = confirm(`Delete ${filename} from workspace gist? This cannot be undone.`);
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
			status = `Deleted ${filename}.`;
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to delete file.";
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
			error = "Missing workspace authorization.";
			return;
		}
		if (!workspace) {
			status = "Refresh workspace first.";
			return;
		}

		const filesToDelete = workspace.files
			.map((file) => file.filename)
			.filter((name) => !isConfigFile(name));
		if (filesToDelete.length === 0) {
			status = "No removable files found.";
			return;
		}

		const ok = confirm(
			`Delete ${filesToDelete.length} workspace file(s) except ${WORKSPACE_FILE}? This cannot be undone.`
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
			status = `Deleted ${filesToDelete.length} file(s).`;
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to clean files.";
		} finally {
			deleting = false;
		}
	}
</script>

<section class="flex flex-col gap-6">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold">Gist Workspace</h1>
			<p class="mt-2 text-sm text-slate-300">
				View published files inside your workspace gist.
			</p>
		</div>
		<div class="flex flex-wrap gap-3">
			<a class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold" href="/auth">
				Open Workspace
			</a>
			<button
				class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
				on:click={refreshWorkspace}
				disabled={loading}
			>
				{loading ? "Loading..." : "Refresh"}
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
			<h2 class="text-lg font-semibold">Workspace Files</h2>
			<span class="text-xs text-slate-400">
				{$appState.activeGistId ? $appState.activeGistId : "No workspace"}
			</span>
		</div>
		<p class="mt-2 text-xs text-slate-400">
			{WORKSPACE_FILE} is protected. All other workspace files can be deleted.
		</p>
		<div class="mt-3">
			<button
				class="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold disabled:opacity-50"
				on:click={cleanWorkspaceFiles}
				disabled={deleting}
			>
				{deleting ? "Working..." : `Clean All Except ${WORKSPACE_FILE}`}
			</button>
		</div>
		<div class="mt-4 grid gap-3">
			{#if !workspace}
				<p class="text-sm text-slate-400">Refresh to load files.</p>
			{:else if workspace.files.length === 0}
				<p class="text-sm text-slate-400">No files in workspace.</p>
			{:else}
				{#each workspace.files as file}
					<div class="rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<p class="text-sm font-semibold">{file.filename}</p>
								<p class="text-xs text-slate-400">{file.size} bytes</p>
								{#if isConfigFile(file.filename)}
									<p class="text-[11px] text-sky-300">Workspace config</p>
								{:else if isManagedOutput(file.filename)}
									<p class="text-[11px] text-emerald-300">Managed output</p>
								{:else}
									<p class="text-[11px] text-slate-500">Unmanaged file</p>
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
										Open
									</a>
								{/if}
								<button
									class="rounded-full border border-slate-700 px-3 py-1"
									on:click={() => copyLink(file.rawUrl)}
								>
									Copy Link
								</button>
								<button
									class="rounded-full border border-rose-700 px-3 py-1 text-rose-200 disabled:opacity-50"
									on:click={() => deleteWorkspaceFile(file.filename)}
									disabled={!canDelete(file.filename) || deleting}
								>
									Delete
								</button>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>
