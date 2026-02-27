<script lang="ts">
	import { appState, replaceState } from "$lib/stores/app";
	import { authState, clearAuth, setToken } from "$lib/stores/auth";
	import { exportState, exportSyncState, importState } from "$lib/serialization";
	import { getGistFileContent } from "$lib/gist";
	import { ensureWorkspaceGist, WORKSPACE_FILE } from "$lib/workspace";
	import { nowIso } from "$lib/utils/time";

	let tokenInput = "";
	let status: string | null = null;
	let payload = "";
	let workspaceBusy = false;

	async function handleTokenSave() {
		status = null;
		const token = tokenInput.trim();
		if (!token) {
			status = "Token is required.";
			return;
		}

		setToken(token);
		tokenInput = "";
		workspaceBusy = true;

		try {
			const { gist, created } = await ensureWorkspaceGist(token, exportSyncState($appState));
			if (!created) {
				try {
					const content = await getGistFileContent(token, gist.id, WORKSPACE_FILE);
					const next = importState(content);
					replaceState({
						...next,
						gists: $appState.gists,
						activeGistId: gist.id,
						activeGistFile: WORKSPACE_FILE
					});
					status = "Workspace gist loaded.";
				} catch (err) {
					status = err instanceof Error ? err.message : "Failed to load workspace gist.";
				}
			} else {
				appState.update((state) => ({
					...state,
					activeGistId: gist.id,
					activeGistFile: WORKSPACE_FILE,
					lastUpdated: nowIso()
				}));
				status = "Workspace gist created.";
			}
		} catch (err) {
			status = err instanceof Error ? err.message : "Failed to setup workspace gist.";
		} finally {
			workspaceBusy = false;
		}
	}

	function handleTokenClear() {
		clearAuth();
		appState.update((state) => ({
			...state,
			activeGistId: null,
			activeGistFile: "subman.json",
			lastUpdated: nowIso()
		}));
		status = "Token cleared. Local mode enabled.";
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
			Use a GitHub token to sync with your workspace gist, or keep data locally.
		</p>
	</header>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<h2 class="text-lg font-semibold">GitHub Token</h2>
		<p class="mt-2 text-xs text-slate-400">
			Token required to read/write gists. The workspace gist is identified by a fixed marker and created if missing.
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
					Workspace gist: {$appState.activeGistId} (file: {$appState.activeGistFile || "subman.json"})
				</p>
			{/if}
		</div>
	</div>

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
