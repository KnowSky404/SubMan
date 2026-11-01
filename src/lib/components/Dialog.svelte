<script lang="ts">
import type { Snippet } from "svelte";
import { handleModalKeydown, modal } from "$lib/actions/modal";
import { surfaceMotion, veilMotion } from "$lib/ui-motion";
import { cn } from "$lib/utils/cn";

let {
	label,
	labelledby,
	closeLabel,
	onclose,
	initialFocus,
	className = "max-w-2xl",
	mobileSheet = true,
	dismissible = true,
	busy = false,
	children,
}: {
	label?: string;
	labelledby?: string;
	closeLabel: string;
	onclose: () => void;
	initialFocus?: string;
	className?: string;
	mobileSheet?: boolean;
	dismissible?: boolean;
	busy?: boolean;
	children: Snippet;
} = $props();

function close() {
	if (dismissible) onclose();
}
</script>

<div class={cn("gh-dialog-layer", mobileSheet && "gh-dialog-sheet")} use:modal={{ onclose: close, initialFocus }} data-ui-motion>
	{#if dismissible}
		<button type="button" class="gh-dialog-backdrop" tabindex="-1" aria-label={closeLabel} onclick={close} transition:veilMotion></button>
	{:else}
		<div class="gh-dialog-backdrop" aria-hidden="true" transition:veilMotion></div>
	{/if}
	<div class={cn("gh-dialog gh-box", className)} role="dialog" onkeydown={(event) => handleModalKeydown(event, close)} aria-modal="true" aria-busy={busy} aria-label={label} aria-labelledby={labelledby} tabindex="-1" in:surfaceMotion out:surfaceMotion={{ duration: 140 }}>
		{@render children()}
	</div>
</div>
