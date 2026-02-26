<script lang="ts">
	import { browser } from "$app/environment";
	import { authState, setToken, updateAuthConfig } from "$lib/stores/auth";
	import { buildAuthorizeUrl } from "$lib/github";

	let clientId = "";
	let redirectUri = "";
	let scopes = "gist";
	let tokenInput = "";
	let status: string | null = null;

	$: if (browser && !redirectUri) {
		redirectUri = `${window.location.origin}/auth/callback`;
	}

	$: if (clientId === "" && $authState.clientId) {
		clientId = $authState.clientId;
	}

	$: if (scopes === "gist" && $authState.scopes.length > 0) {
		scopes = $authState.scopes.join(" ");
	}

	function saveConfig() {
		updateAuthConfig({
			clientId,
			redirectUri,
			scopes: scopes.split(" ").map((scope) => scope.trim()).filter(Boolean)
		});
		status = "Config saved.";
	}

	async function startOAuth() {
		status = null;
		if (!clientId || !redirectUri) {
			status = "Client ID and redirect URI are required.";
			return;
		}
		const url = await buildAuthorizeUrl({
			clientId,
			redirectUri,
			scopes: scopes.split(" ").map((scope) => scope.trim()).filter(Boolean)
		});
		if (url) {
			window.location.assign(url);
		}
	}

	function saveToken() {
		setToken(tokenInput.trim());
		tokenInput = "";
		status = "Token stored locally.";
	}

	function clearToken() {
		setToken(null);
		status = "Token cleared.";
	}
</script>

<section class="flex flex-col gap-6">
	<header>
		<h1 class="text-2xl font-semibold">GitHub Auth</h1>
		<p class="mt-2 text-sm text-slate-300">
			Configure OAuth and token storage. This is a front-end only flow.
		</p>
	</header>

	<div class="grid gap-6 lg:grid-cols-2">
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">OAuth Config</h2>
			<p class="mt-2 text-xs text-slate-400">
				Use your GitHub OAuth App. Redirect URI should match exactly.
			</p>
			<div class="mt-4 grid gap-3 text-sm">
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					placeholder="GitHub OAuth Client ID"
					bind:value={clientId}
				/>
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					placeholder="Redirect URI"
					bind:value={redirectUri}
				/>
				<input
					class="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
					placeholder="Scopes (space separated)"
					bind:value={scopes}
				/>
				<div class="flex flex-wrap gap-3">
					<button
						class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold"
						on:click={saveConfig}
					>
						Save Config
					</button>
					<button
						class="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950"
						on:click={startOAuth}
					>
						Start OAuth
					</button>
				</div>
			</div>
		</div>

		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Token Storage</h2>
			<p class="mt-2 text-xs text-slate-400">
				Paste a fine-grained PAT if you cannot complete OAuth without a backend.
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
						on:click={saveToken}
					>
						Save Token
					</button>
					<button
						class="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold"
						on:click={clearToken}
					>
						Clear Token
					</button>
				</div>
				<p class="text-xs text-slate-400">
					Current token: {$authState.token ? "Stored" : "Not set"}
				</p>
			</div>
		</div>
	</div>

	<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
		<h2 class="text-lg font-semibold">Front-end OAuth Notes</h2>
		<p class="mt-2 text-sm text-slate-300">
			This UI builds the authorization URL and receives the callback. Token exchange still needs a secure
			backend or a manual token entry to keep secrets safe.
		</p>
	</div>

	{#if status}
		<p class="text-xs text-slate-300">{status}</p>
	{/if}
</section>
