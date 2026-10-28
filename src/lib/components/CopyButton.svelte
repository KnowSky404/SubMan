<script lang="ts">
import { onDestroy } from "svelte";
import { tooltip } from "$lib/actions/tooltip";
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import { check, copy, sync } from "$lib/octicons";
import { showToast } from "$lib/stores/toast";
import { cn } from "$lib/utils/cn";

let {
	value,
	oncopy,
	label,
	showLabel = false,
	disabled = false,
	className = "gh-btn gh-btn-sm",
}: {
	value?: string;
	oncopy?: () => Promise<boolean | undefined>;
	label: string;
	showLabel?: boolean;
	disabled?: boolean;
	className?: string;
} = $props();
let clipboardState = $state<"idle" | "copying" | "copied">("idle");
let timer: ReturnType<typeof setTimeout>;
let mounted = true;
async function copyValue() {
	if (clipboardState === "copying" || disabled) return;
	clearTimeout(timer);
	clipboardState = "copying";
	const requestedValue = value;
	try {
		if (oncopy) {
			if ((await oncopy()) === false) {
				clipboardState = "idle";
				return;
			}
		} else await navigator.clipboard.writeText(value ?? "");
		if (!mounted) return;
		if (requestedValue !== value) {
			clipboardState = "idle";
			return;
		}
		clipboardState = "copied";
		timer = setTimeout(() => {
			clipboardState = "idle";
		}, 1200);
	} catch {
		if (!mounted) return;
		clipboardState = "idle";
		showToast($t("Copy failed"), "error");
	}
}
onDestroy(() => {
	mounted = false;
	clearTimeout(timer);
});
</script>

<button type="button" class={cn(className, "gh-copy-button")} aria-label={label} aria-busy={clipboardState === "copying"} {disabled} data-feedback={clipboardState} use:tooltip={clipboardState === "copied" ? $t("Copied to clipboard") : label} onclick={copyValue}>
	<span class="gh-feedback-icon"><Octicon icon={clipboardState === "copied" ? check : clipboardState === "copying" ? sync : copy} className={cn("h-4 w-4", clipboardState === "copying" && "animate-spin")} /></span>
	{#if showLabel}<span>{label}</span>{/if}
</button>
<span class="sr-only" role="status">{clipboardState === "copied" ? $t("Copied to clipboard") : ""}</span>
