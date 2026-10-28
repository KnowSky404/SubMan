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
	children,
}: {
	label?: string;
	labelledby?: string;
	closeLabel: string;
	onclose: () => void;
	initialFocus?: string;
	className?: string;
	mobileSheet?: boolean;
	children: Snippet;
} = $props();
</script>

<div class={cn("gh-dialog-layer", mobileSheet && "gh-dialog-sheet")} use:modal={{ onclose, initialFocus }} data-ui-motion>
	<button type="button" class="gh-dialog-backdrop" tabindex="-1" aria-label={closeLabel} onclick={onclose} transition:veilMotion></button>
	<div class={cn("gh-dialog gh-box", className)} role="dialog" onkeydown={(event) => handleModalKeydown(event, onclose)} aria-modal="true" aria-label={label} aria-labelledby={labelledby} tabindex="-1" in:surfaceMotion out:surfaceMotion={{ duration: 140 }}>
		{@render children()}
	</div>
</div>
