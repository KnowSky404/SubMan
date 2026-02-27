<script lang="ts">
	import type { GistMeta } from "$lib/models";
	import { appState } from "$lib/stores/app";
	import { authState } from "$lib/stores/auth";
	import { getGist } from "$lib/gist";

	let workspace: GistMeta | null = null;
	let loading = false;
	let error: string | null = null;
	let status: string | null = null;

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
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>
