<script lang="ts">
	import { appState, replaceState } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import { createGist, getGistFileContent, listGists, updateGist } from "$lib/gist";
	import { exportSyncState, importState } from "$lib/serialization";
	import { nowIso } from "$lib/utils/time";

	let loading = false;
	let error: string | null = null;
	let syncStatus: string | null = null;
	let syncLoading = false;
	let gistId = "";
	let gistFile = "subman.json";
	let gistDescription = "SubMan data";
	let gistPublic = false;
	let initialized = false;

	$: if (!initialized) {
		gistId = $appState.activeGistId ?? "";
		gistFile = $appState.activeGistFile || "subman.json";
		initialized = true;
	}

	async function refreshGists() {
		error = null;
		const token = $authState.token;
		if (!token) {
			error = "Missing GitHub token. Connect first.";
			return;
		}

		loading = true;
		try {
			const gists = await listGists(token);
			appState.update((state) => ({ ...state, gists, lastUpdated: nowIso() }));
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load gists";
		} finally {
			loading = false;
		}
	}

	async function loadFromGist() {
		syncStatus = null;
		const token = $authState.token;
		if (!token) {
			syncStatus = "Missing GitHub token. Connect first.";
			return;
		}
		if (!gistId || !gistFile) {
			syncStatus = "Gist ID and file name are required.";
			return;
		}

		syncLoading = true;
		try {
			const content = await getGistFileContent(token, gistId, gistFile);
			const next = importState(content);
			const currentGists = $appState.gists;
			replaceState({
				...next,
				gists: currentGists,
				activeGistId: gistId,
				activeGistFile: gistFile
			});
			syncStatus = "Loaded data from gist.";
		} catch (err) {
			syncStatus = err instanceof Error ? err.message : "Failed to load gist content.";
		} finally {
			syncLoading = false;
		}
	}

	async function saveToGist() {
		syncStatus = null;
		const token = $authState.token;
		if (!token) {
			syncStatus = "Missing GitHub token. Connect first.";
			return;
		}
		if (!gistFile) {
			syncStatus = "File name is required.";
			return;
		}

		syncLoading = true;
		try {
			const content = exportSyncState($appState);
			let targetId = gistId;

			if (targetId) {
				await updateGist(token, {
					gistId: targetId,
					description: gistDescription || undefined,
					files: {
						[gistFile]: { content }
					}
				});
			} else {
				const created = await createGist(token, {
					description: gistDescription || "SubMan data",
					isPublic: gistPublic,
					files: {
						[gistFile]: { content }
					}
				});
				targetId = created.id;
				gistId = created.id;
			}

			appState.update((state) => ({
				...state,
				activeGistId: targetId,
				activeGistFile: gistFile,
				lastUpdated: nowIso()
			}));

			syncStatus = "Saved data to gist.";
		} catch (err) {
			syncStatus = err instanceof Error ? err.message : "Failed to save gist content.";
		} finally {
			syncLoading = false;
		}
	}
</script>

<section class="flex flex-col gap-6">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold">Gist Storage</h1>
			<p class="mt-2 text-sm text-slate-300">
				Browse gists that store raw node lists or generated subscriptions.
			</p>
		</div>
		<div class="flex flex-wrap gap-3">
			<a class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold" href="/auth">
				Configure Auth
			</a>
			<button
				class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
				on:click={refreshGists}
				disabled={loading}
			>
				{loading ? "Loading..." : "Fetch Gists"}
			</button>
		</div>
	</div>

	{#if error}
		<div class="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
			{error}
		</div>
	{/if}

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h2 class="text-lg font-semibold">Sync Workspace</h2>
				<p class="mt-2 text-xs text-slate-400">
					Load or save the local state to a gist file (default: subman.json).
				</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<button
					class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold"
					on:click={loadFromGist}
					disabled={syncLoading}
				>
					{syncLoading ? "Working..." : "Load from Gist"}
				</button>
				<button
					class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950"
					on:click={saveToGist}
					disabled={syncLoading}
				>
					{syncLoading ? "Working..." : "Save to Gist"}
				</button>
			</div>
		</div>
		{#if syncStatus}
			<p class="mt-3 text-xs text-slate-300">{syncStatus}</p>
		{/if}
		<div class="mt-4 grid gap-3 text-sm md:grid-cols-2">
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="Gist ID"
				bind:value={gistId}
			/>
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="File name (e.g. subman.json)"
				bind:value={gistFile}
			/>
			<input
				class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
				placeholder="Gist description"
				bind:value={gistDescription}
			/>
			<label class="inline-flex items-center gap-2 text-xs text-slate-300">
				<input type="checkbox" class="h-4 w-4" bind:checked={gistPublic} />
				Public gist
			</label>
		</div>
	</div>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold">Available Gists</h2>
			<span class="text-xs text-slate-400">{$appState.gists.length} items</span>
		</div>
		<div class="mt-4 grid gap-3">
			{#if $appState.gists.length === 0}
				<p class="text-sm text-slate-400">No gists loaded yet.</p>
			{:else}
				{#each $appState.gists as gist}
					<div class="rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-3">
						<div class="flex items-center justify-between gap-3">
							<div>
								<p class="text-sm font-semibold">{gist.description || "Untitled gist"}</p>
								<p class="text-xs text-slate-400">Updated {gist.updatedAt}</p>
							</div>
							<div class="flex items-center gap-3 text-xs">
								<button
									class="rounded-full border border-slate-700 px-3 py-1"
									on:click={() => {
										gistId = gist.id;
										gistDescription = gist.description || "SubMan data";
									}}
								>
									Use
								</button>
								<a
									class="text-slate-300 hover:text-white"
									href={gist.url}
									target="_blank"
									rel="noreferrer"
								>
									Open
								</a>
							</div>
						</div>
						<div class="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
							{#each gist.files as file}
								<span class="rounded-full border border-slate-800 px-2 py-1">
									{file.filename}
								</span>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>
