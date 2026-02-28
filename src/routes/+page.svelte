<script>
	import { t } from "$lib/i18n";
</script>

<section class="flex flex-col gap-10">
	<div class="flex flex-col gap-5">
		<p class="text-xs uppercase tracking-[0.25em] text-slate-400">{$t("SubMan")}</p>
		<h1 class="text-4xl font-semibold leading-tight md:text-5xl">
			{$t("Workspace Gist subscription hub for proxy nodes")}
		</h1>
		<p class="max-w-2xl text-base text-slate-300 md:text-lg">
			{$t(
				"Manage nodes and subscriptions, build reusable aggregation rules, and publish stable subscription links from one GitHub Workspace Gist."
			)}
		</p>
		<div class="flex flex-wrap gap-3">
			<a class="rounded-full bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-950" href="/auth">
				{$t("Connect Workspace")}
			</a>
			<a class="rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-100" href="/aggregate">
				{$t("Publish Subscription")}
			</a>
		</div>
	</div>

	<div class="grid gap-6 md:grid-cols-3">
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">{$t("Workspace Sync")}</h2>
			<p class="mt-2 text-sm text-slate-300">
				{$t(
					"Bind to your fixed Workspace Gist, resolve local and remote conflicts, and keep data in sync."
				)}
			</p>
			<a class="mt-4 inline-flex text-sm font-semibold text-slate-100 hover:text-white" href="/gists">
				{$t("Open Workspace ->")}
			</a>
		</div>
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">{$t("Node Management")}</h2>
			<p class="mt-2 text-sm text-slate-300">
				{$t(
					"Add or edit single nodes and subscription sources with tags, filters, and quick status toggles."
				)}
			</p>
			<a class="mt-4 inline-flex text-sm font-semibold text-slate-100 hover:text-white" href="/nodes">
				{$t("Manage Nodes ->")}
			</a>
		</div>
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">{$t("Publish Targets")}</h2>
			<p class="mt-2 text-sm text-slate-300">
				{$t(
					"Reuse one rule across multiple output files and keep client links stable with overwrite publishing."
				)}
			</p>
			<a class="mt-4 inline-flex text-sm font-semibold text-slate-100 hover:text-white" href="/aggregate">
				{$t("Open Aggregate ->")}
			</a>
		</div>
	</div>
</section>
