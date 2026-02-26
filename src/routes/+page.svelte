<section class="flex flex-col gap-10">
	<div class="flex flex-col gap-5">
		<p class="text-xs uppercase tracking-[0.25em] text-slate-400">SubMan</p>
		<h1 class="text-4xl font-semibold leading-tight md:text-5xl">
			Gist-first subscription manager for VLESS / VMess
		</h1>
		<p class="max-w-2xl text-base text-slate-300 md:text-lg">
			Pure front-end aggregation and editing for proxy nodes, stored directly in GitHub Gists.
		</p>
		<div class="flex flex-wrap gap-3">
			<a class="rounded-full bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-950" href="/auth">
				Connect GitHub
			</a>
			<a class="rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-100" href="/aggregate">
				Build Aggregation
			</a>
		</div>
	</div>

	<div class="grid gap-6 md:grid-cols-3">
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Gist Storage</h2>
			<p class="mt-2 text-sm text-slate-300">
				Browse, pick, and sync gists that hold node lists or generated subscriptions.
			</p>
			<a class="mt-4 inline-flex text-sm font-semibold text-slate-100 hover:text-white" href="/gists">
				Open Gists ->
			</a>
		</div>
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Node Editing</h2>
			<p class="mt-2 text-sm text-slate-300">
				Rename, disable, or tag individual nodes before aggregation.
			</p>
			<a class="mt-4 inline-flex text-sm font-semibold text-slate-100 hover:text-white" href="/nodes">
				Edit Nodes ->
			</a>
		</div>
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Aggregation Flow</h2>
			<p class="mt-2 text-sm text-slate-300">
				Combine multiple sources into a single subscription and export the result.
			</p>
			<a class="mt-4 inline-flex text-sm font-semibold text-slate-100 hover:text-white" href="/aggregate">
				Aggregate ->
			</a>
		</div>
	</div>
</section>
