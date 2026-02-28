<section class="flex flex-col gap-10">
	<div class="flex flex-col gap-5">
		<p class="text-xs uppercase tracking-[0.25em] text-slate-400">SubMan</p>
		<h1 class="text-4xl font-semibold leading-tight md:text-5xl">
			Workspace Gist subscription hub for proxy nodes
		</h1>
		<p class="max-w-2xl text-base text-slate-300 md:text-lg">
			Manage nodes and subscriptions, build reusable aggregation rules, and publish stable
			subscription links from one GitHub Workspace Gist.
		</p>
		<div class="flex flex-wrap gap-3">
			<a class="rounded-full bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-950" href="/auth">
				Connect Workspace
			</a>
			<a class="rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-100" href="/aggregate">
				Publish Subscription
			</a>
		</div>
	</div>

	<div class="grid gap-6 md:grid-cols-3">
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Workspace Sync</h2>
			<p class="mt-2 text-sm text-slate-300">
				Bind to your fixed Workspace Gist, resolve local and remote conflicts, and keep data in sync.
			</p>
			<a class="mt-4 inline-flex text-sm font-semibold text-slate-100 hover:text-white" href="/gists">
				Open Workspace ->
			</a>
		</div>
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Node Management</h2>
			<p class="mt-2 text-sm text-slate-300">
				Add or edit single nodes and subscription sources with tags, filters, and quick status toggles.
			</p>
			<a class="mt-4 inline-flex text-sm font-semibold text-slate-100 hover:text-white" href="/nodes">
				Manage Nodes ->
			</a>
		</div>
		<div class="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
			<h2 class="text-lg font-semibold">Publish Targets</h2>
			<p class="mt-2 text-sm text-slate-300">
				Reuse one rule across multiple output files and keep client links stable with overwrite publishing.
			</p>
			<a class="mt-4 inline-flex text-sm font-semibold text-slate-100 hover:text-white" href="/aggregate">
				Open Aggregate ->
			</a>
		</div>
	</div>
</section>
