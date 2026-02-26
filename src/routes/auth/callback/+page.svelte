<script lang="ts">
	import { page } from "$app/stores";
	import { clearOAuthArtifacts, readCallback, verifyState } from "$lib/github";

	let callback: { code: string | null; state: string | null; verifier: string | null } = {
		code: null,
		state: null,
		verifier: null
	};
	let stateValid = false;

	$: callback = readCallback($page.url.search);
	$: stateValid = verifyState(callback.state);

	function clearArtifacts() {
		clearOAuthArtifacts();
	}
</script>

<section class="flex flex-col gap-6">
	<header>
		<h1 class="text-2xl font-semibold">OAuth Callback</h1>
		<p class="mt-2 text-sm text-slate-300">Handle the authorization redirect here.</p>
	</header>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<p class="text-sm text-slate-200">Code: {callback.code || "Missing"}</p>
		<p class="text-sm text-slate-200">State: {callback.state || "Missing"}</p>
		<p class="text-sm text-slate-200">State verified: {stateValid ? "Yes" : "No"}</p>
		<p class="mt-2 text-xs text-slate-400">Verifier stored in session storage.</p>
	</div>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<h2 class="text-lg font-semibold">Next Step</h2>
		<p class="mt-2 text-sm text-slate-300">
			Use the code + verifier to exchange for a token. Without a backend, paste a token in the Auth page.
		</p>
		<div class="mt-4 flex flex-wrap gap-3">
			<a class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold" href="/auth">
				Back to Auth
			</a>
			<button class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold" on:click={clearArtifacts}>
				Clear Session
			</button>
		</div>
	</div>
</section>
