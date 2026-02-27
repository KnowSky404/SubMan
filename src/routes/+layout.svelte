<script>
	import "../app.css";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { startAutoSync } from "$lib/sync";

	const navItems = [
		{ href: "/", label: "Overview" },
		{ href: "/gists", label: "Gists" },
		{ href: "/nodes", label: "Nodes" },
		{ href: "/aggregate", label: "Aggregate" },
		{ href: "/auth", label: "Workspace" }
	];

	$: pathname = $page.url.pathname;
	$: isActive = (href) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

	onMount(() => startAutoSync());
</script>

<div class="min-h-screen bg-slate-950 text-slate-100">
	<header class="border-b border-slate-800/70 bg-slate-950/80 backdrop-blur">
		<div class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
			<div>
				<p class="text-xs uppercase tracking-[0.3em] text-slate-400">SubMan</p>
				<p class="text-lg font-semibold">Gist-first Proxy Manager</p>
			</div>
			<nav class="hidden flex-wrap items-center gap-4 text-sm md:flex">
				{#each navItems as item}
					<a
						class={`rounded-full px-3 py-1 transition ${
							isActive(item.href)
								? "bg-slate-100 text-slate-950"
								: "text-slate-300 hover:text-slate-100"
						}`}
						href={item.href}
					>
						{item.label}
					</a>
				{/each}
			</nav>
		</div>
	</header>

	<main class="mx-auto w-full max-w-6xl px-6 py-10">
		<slot />
	</main>
</div>
