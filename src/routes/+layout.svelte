<script>
	import "../app.css";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { locale, t } from "$lib/i18n";
	import { startAutoSync } from "$lib/sync";

	const PROJECT_GITHUB_URL = "https://github.com/KnowSky404/SubMan";
	const navItems = [
		{ href: "/", label: "Overview" },
		{ href: "/gists", label: "Gists" },
		{ href: "/nodes", label: "Nodes" },
		{ href: "/aggregate", label: "Aggregate" },
		{ href: "/auth", label: "Workspace" }
	];

	$: pathname = $page.url.pathname;
	$: isActive = (href) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

	function handleLocaleChange(event) {
		const nextLocale = event.currentTarget.value;
		if (nextLocale === "en" || nextLocale === "zh-CN") {
			locale.set(nextLocale);
		}
	}

	onMount(() => startAutoSync());
</script>

<div class="min-h-screen bg-slate-950 text-slate-100">
	<header class="border-b border-slate-800/70 bg-slate-950/80 backdrop-blur">
		<div class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
			<div>
				<p class="text-xs uppercase tracking-[0.3em] text-slate-400">{$t("SubMan")}</p>
				<p class="text-lg font-semibold">{$t("Gist-first Proxy Manager")}</p>
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
						{$t(item.label)}
					</a>
				{/each}

				<div class="h-5 w-px bg-slate-700/80" aria-hidden="true"></div>
				<div class="relative">
					<label class="sr-only" for="locale-switch">{$t("Language")}</label>
					<select
						id="locale-switch"
						class="appearance-none rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 pr-7 text-xs text-slate-100 outline-none ring-0 focus:border-slate-500"
						value={$locale}
						on:change={handleLocaleChange}
					>
						<option value="en">{$t("English")}</option>
						<option value="zh-CN">{$t("简体中文")}</option>
					</select>
					<span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
						v
					</span>
				</div>
				<a
					class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-slate-500 hover:text-white"
					href={PROJECT_GITHUB_URL}
					target="_blank"
					rel="noreferrer"
					aria-label={$t("GitHub")}
					title={$t("GitHub")}
				>
					<svg viewBox="0 0 24 24" class="h-4 w-4 fill-current" aria-hidden="true">
						<path
							d="M12 1.5a10.5 10.5 0 0 0-3.32 20.47c.53.1.72-.22.72-.5v-1.85c-2.95.64-3.57-1.25-3.57-1.25-.49-1.22-1.18-1.55-1.18-1.55-.96-.65.07-.63.07-.63 1.06.08 1.62 1.07 1.62 1.07.94 1.6 2.47 1.14 3.07.87.09-.67.37-1.14.66-1.4-2.35-.26-4.81-1.15-4.81-5.13 0-1.14.42-2.07 1.1-2.8-.11-.27-.48-1.36.1-2.83 0 0 .9-.28 2.96 1.07A10.45 10.45 0 0 1 12 6.8c.92 0 1.85.12 2.72.35 2.06-1.35 2.96-1.07 2.96-1.07.58 1.47.21 2.56.1 2.83.69.73 1.1 1.66 1.1 2.8 0 3.99-2.47 4.86-4.82 5.12.38.32.72.94.72 1.9v2.82c0 .28.19.6.73.5A10.5 10.5 0 0 0 12 1.5Z"
						></path>
					</svg>
				</a>
			</nav>
		</div>
	</header>

	<main class="mx-auto w-full max-w-6xl px-6 py-10">
		<slot />
	</main>
</div>
