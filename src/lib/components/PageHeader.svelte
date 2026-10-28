<script lang="ts">
import type { Snippet } from "svelte";

let {
	title,
	description,
	children,
}: { title: string; description?: string; children?: Snippet } = $props();
</script>

<header class="gh-page-header">
	<div class="gh-page-heading">
		<h1 class="gh-page-title">{title}</h1>
		{#if description}<p class="gh-page-description">{description}</p>{/if}
	</div>
	{#if children}<div class="gh-page-actions">{@render children()}</div>{/if}
</header>
