<script lang="ts">
import { appState, replaceState } from "$lib/stores/app";
	import { authState, clearAuth, setToken } from "$lib/stores/auth";
	import { exportState, exportSyncState, importState } from "$lib/serialization";
	import { getGistFileContent, updateGist } from "$lib/gist";
	import { ensureWorkspaceGist, WORKSPACE_DESCRIPTION, WORKSPACE_FILE } from "$lib/workspace";
	import { mergeSyncState } from "$lib/merge";
	import { setSyncBaseline } from "$lib/sync";
	import { nowIso } from "$lib/utils/time";
	import type { AppState } from "$lib/models";

	type WorkspaceConflict = {
		gistId: string;
		localPayload: string;
		remotePayload: string;
		remoteState: AppState;
		localStats: { nodes: number; subscriptions: number; aggregates: number; updatedAt: string };
		remoteStats: { nodes: number; subscriptions: number; aggregates: number; updatedAt: string };
	};

	let tokenInput = "";
	let status: string | null = null;
	let payload = "";
	let workspaceBusy = false;
	let conflict: WorkspaceConflict | null = null;
	let pendingGistId: string | null = null;

	function snapshotStats(state: AppState) {
		return {
			nodes: state.nodes.length,
			subscriptions: state.subscriptions.length,
			aggregates: state.aggregates.length,
			updatedAt: state.lastUpdated
		};
	}

	function applyWorkspaceState(next: AppState, gistId: string) {
		replaceState({
			...next,
			gists: $appState.gists,
			activeGistId: gistId,
			activeGistFile: WORKSPACE_FILE
		});
	}

	async function handleTokenSave() {
		status = null;
		conflict = null;
		pendingGistId = null;
		const token = tokenInput.trim();
		if (!token) {
			status = "Token is required.";
			return;
		}

		setToken(token);
		tokenInput = "";
		workspaceBusy = true;

		try {
			const localPayload = exportSyncState($appState);
			const { gist, created } = await ensureWorkspaceGist(token, localPayload);

			if (created) {
				appState.update((state) => ({
					...state,
					activeGistId: gist.id,
					activeGistFile: WORKSPACE_FILE,
					lastUpdated: nowIso()
				}));
				setSyncBaseline(localPayload);
				status = "Workspace gist created.";
				return;
			}

			let content: string | null = null;
			try {
				content = await getGistFileContent(token, gist.id, WORKSPACE_FILE);
			} catch (err) {
				const message = err instanceof Error ? err.message : "";
			if (message.includes("File not found in gist")) {
				await updateGist(token, {
					gistId: gist.id,
					files: {
						[WORKSPACE_FILE]: { content: localPayload }
					}
				});
				content = localPayload;
				status = "Workspace file missing. Local data seeded.";
			} else {
				throw err;
			}
			}

			if (!content) {
				status = "Workspace data unavailable.";
				return;
			}

			const remoteState = importState(content);
			const remotePayload = exportSyncState(remoteState);
			const gistMismatch = Boolean($appState.activeGistId && $appState.activeGistId !== gist.id);
			const payloadMismatch = localPayload !== remotePayload;

			pendingGistId = gist.id;
			conflict = {
				gistId: gist.id,
				localPayload,
				remotePayload,
				remoteState,
				localStats: snapshotStats($appState),
				remoteStats: snapshotStats(remoteState)
			};

			if (!gistMismatch && !payloadMismatch) {
				applyWorkspaceState(remoteState, gist.id);
				setSyncBaseline(remotePayload);
				status = "Workspace gist linked. No sync needed.";
				conflict = null;
			} else if (!status) {
				status = "Workspace gist linked. Review sync options below.";
			}
		} catch (err) {
			status = err instanceof Error ? err.message : "Failed to setup workspace gist.";
		} finally {
			workspaceBusy = false;
		}
	}

	async function handleResolveConflict(action: "local" | "remote" | "merge") {
		if (!conflict || !$authState.token) {
			return;
		}

		workspaceBusy = true;
		status = null;

		try {
			if (action === "remote") {
				applyWorkspaceState(conflict.remoteState, conflict.gistId);
				setSyncBaseline(conflict.remotePayload);
				status = "Remote data loaded.";
				conflict = null;
				return;
			}

			const token = $authState.token;
			if (!token) {
				status = "Token missing.";
				return;
			}

			if (action === "local") {
				await updateGist(token, {
					gistId: conflict.gistId,
					files: {
						[WORKSPACE_FILE]: { content: conflict.localPayload }
					}
				});
				appState.update((state) => ({
					...state,
					activeGistId: conflict.gistId,
					activeGistFile: WORKSPACE_FILE,
					lastUpdated: nowIso()
				}));
				setSyncBaseline(conflict.localPayload);
				status = "Local data pushed to workspace.";
				conflict = null;
				return;
			}

			const merged = mergeSyncState($appState, conflict.remoteState);
			const mergedState: AppState = {
				...$appState,
				...merged,
				lastUpdated: nowIso()
			};

			const mergedPayload = exportSyncState(mergedState);
			await updateGist(token, {
				gistId: conflict.gistId,
				files: {
					[WORKSPACE_FILE]: { content: mergedPayload }
				}
			});

			applyWorkspaceState(mergedState, conflict.gistId);
			setSyncBaseline(mergedPayload);
			status = "Merged data saved to workspace.";
			conflict = null;
		} catch (err) {
			status = err instanceof Error ? err.message : "Failed to resolve conflict.";
		} finally {
			workspaceBusy = false;
		}
	}

	function linkWorkspaceOnly() {
		if (!pendingGistId) {
			return;
		}
		const baseline = exportSyncState($appState);
		appState.update((state) => ({
			...state,
			activeGistId: pendingGistId,
			activeGistFile: WORKSPACE_FILE,
			lastUpdated: nowIso()
		}));
		setSyncBaseline(baseline);
		status = "Workspace gist linked (local data unchanged).";
		conflict = null;
	}

	function handleTokenClear() {
		clearAuth();
		appState.update((state) => ({
			...state,
			activeGistId: null,
			activeGistFile: WORKSPACE_FILE,
			lastUpdated: nowIso()
		}));
		status = "Token cleared. Local mode enabled.";
		conflict = null;
	}

	function handleExport() {
		payload = exportState($appState);
		status = "Export ready.";
	}

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(payload);
			status = "Copied to clipboard.";
		} catch {
			status = "Clipboard copy failed.";
		}
	}

	function handleImport() {
		status = null;
		try {
			const next = importState(payload);
			replaceState(next);
			status = "Import complete.";
		} catch (err) {
			status = err instanceof Error ? err.message : "Import failed.";
		}
	}
</script>

<section class="flex flex-col gap-6">
	<header>
		<h1 class="text-2xl font-semibold">Workspace</h1>
		<p class="mt-2 text-sm text-slate-300">
			Use a GitHub token to sync with the workspace gist, or keep data locally.
		</p>
	</header>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<h2 class="text-lg font-semibold">GitHub Token</h2>
		<p class="mt-2 text-xs text-slate-400">
			Workspace marker: {WORKSPACE_DESCRIPTION} / {WORKSPACE_FILE}
		</p>
		<div class="mt-4 grid gap-3 text-sm">
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="GitHub token"
				bind:value={tokenInput}
			/>
			<div class="flex flex-wrap gap-3">
				<button
					class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950"
					on:click={handleTokenSave}
					disabled={workspaceBusy}
				>
					{workspaceBusy ? "Setting up..." : "Save Token"}
				</button>
				<button
					class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold"
					on:click={handleTokenClear}
				>
					Clear Token
				</button>
			</div>
			<p class="text-xs text-slate-400">
				Mode: {$authState.token ? "Gist sync" : "Local only"}
			</p>
			{#if $appState.activeGistId}
				<p class="text-xs text-slate-400">
					Workspace gist: {$appState.activeGistId} (file: {WORKSPACE_FILE})
				</p>
			{/if}
		</div>
	</div>

	{#if conflict}
		<div class="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6">
			<h2 class="text-lg font-semibold">Workspace Sync Options</h2>
			<p class="mt-2 text-xs text-amber-100">
				Workspace is linked. Choose if you want to sync now or keep local data as-is.
			</p>
			<div class="mt-4 grid gap-3 text-xs text-slate-200 md:grid-cols-2">
				<div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
					<p class="font-semibold">Local</p>
					<p>Nodes: {conflict.localStats.nodes}</p>
					<p>Subscriptions: {conflict.localStats.subscriptions}</p>
					<p>Aggregates: {conflict.localStats.aggregates}</p>
					<p>Updated: {conflict.localStats.updatedAt}</p>
				</div>
				<div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
					<p class="font-semibold">Remote</p>
					<p>Nodes: {conflict.remoteStats.nodes}</p>
					<p>Subscriptions: {conflict.remoteStats.subscriptions}</p>
					<p>Aggregates: {conflict.remoteStats.aggregates}</p>
					<p>Updated: {conflict.remoteStats.updatedAt}</p>
				</div>
			</div>
			<div class="mt-4 flex flex-wrap gap-3">
				<button
					class="rounded-full border border-amber-400 px-4 py-2 text-xs font-semibold text-amber-100"
					on:click={linkWorkspaceOnly}
					disabled={workspaceBusy}
				>
					Keep Local (Link Only)
				</button>
				<button
					class="rounded-full border border-amber-400 px-4 py-2 text-xs font-semibold text-amber-100"
					on:click={() => handleResolveConflict("local")}
					disabled={workspaceBusy}
				>
					Local -> Remote
				</button>
				<button
					class="rounded-full border border-amber-400 px-4 py-2 text-xs font-semibold text-amber-100"
					on:click={() => handleResolveConflict("remote")}
					disabled={workspaceBusy}
				>
					Remote -> Local
				</button>
				<button
					class="rounded-full bg-amber-200 px-4 py-2 text-xs font-semibold text-slate-950"
					on:click={() => handleResolveConflict("merge")}
					disabled={workspaceBusy}
				>
					Merge & Save
				</button>
			</div>
		</div>
	{/if}

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<h2 class="text-lg font-semibold">Local Import / Export</h2>
		<p class="mt-2 text-xs text-slate-400">
			Use this for backups or moving data without GitHub.
		</p>
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<button
				class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950"
				on:click={handleExport}
			>
				Generate Export
			</button>
			<button
				class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold"
				on:click={handleImport}
			>
				Import
			</button>
			<button
				class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold"
				on:click={handleCopy}
				disabled={!payload}
			>
				Copy
			</button>
		</div>
		<textarea
			class="mt-4 min-h-[240px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs"
			placeholder="Exported JSON will appear here. Paste JSON to import."
			bind:value={payload}
		/>
	</div>

	{#if status}
		<p class="text-xs text-slate-300">{status}</p>
	{/if}
</section>
