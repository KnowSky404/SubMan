<script lang="ts">
	import { appState, replaceState } from "$lib/stores/app";
	import { exportState, importState } from "$lib/serialization";

	let payload = "";
	let status: string | null = null;

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
		<h1 class="text-2xl font-semibold">Local Data</h1>
		<p class="mt-2 text-sm text-slate-300">
			Export or import local state. This does not touch GitHub yet.
		</p>
	</header>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<div class="flex flex-wrap items-center gap-3">
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
		{#if status}
			<p class="mt-3 text-xs text-slate-300">{status}</p>
		{/if}
		<textarea
			class="mt-4 min-h-[240px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-xs"
			placeholder="Exported JSON will appear here. Paste JSON to import."
			bind:value={payload}
		/>
	</div>
</section>
