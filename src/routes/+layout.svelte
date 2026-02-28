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
		<div class="mx-auto w-full max-w-6xl px-6 py-5">
			<div class="flex items-start justify-between gap-4">
				<div>
					<p class="text-xs uppercase tracking-[0.3em] text-slate-400">{$t("SubMan")}</p>
					<p class="text-lg font-semibold">{$t("Gist-first Proxy Manager")}</p>
				</div>

				<div class="rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2">
					<div class="flex items-center gap-3">
						<div class="grid gap-1">
							<label class="text-[10px] uppercase tracking-[0.2em] text-slate-500" for="locale-switch">
								{$t("Language")}
							</label>
							<div class="relative">
								<select
									id="locale-switch"
									class="appearance-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 pr-8 text-xs text-slate-100 outline-none ring-0 focus:border-slate-500"
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
						</div>
						<a
							class="inline-flex items-center rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
							href={PROJECT_GITHUB_URL}
							target="_blank"
							rel="noreferrer"
						>
							{$t("GitHub")}
						</a>
					</div>
				</div>
			</div>

			<nav class="mt-4 hidden flex-wrap items-center gap-4 border-t border-slate-800/80 pt-4 text-sm md:flex">
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
			</nav>
		</div>
	</header>

	<main class="mx-auto w-full max-w-6xl px-6 py-10">
		<slot />
	</main>
</div>
