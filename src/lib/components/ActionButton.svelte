<script lang="ts">
import { onDestroy } from "svelte";
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import { alert, check, type OcticonData, sync } from "$lib/octicons";
import { showToast } from "$lib/stores/toast";
import { cn } from "$lib/utils/cn";
import type {
	WorkspaceFeedbackState,
	WorkspaceOperationPresentation,
} from "$lib/workspace-operation-presenter";
import { workspaceSyncStatus } from "$lib/workspace-sync-status";

let {
	label,
	busyLabel,
	action,
	icon,
	feedback = null,
	variant = "default",
	disabled = false,
	workspace = true,
	className = "",
}: {
	label: string;
	busyLabel?: string;
	action: () => unknown | Promise<unknown>;
	icon?: OcticonData;
	feedback?: WorkspaceOperationPresentation | null;
	variant?: "default" | "primary" | "danger";
	disabled?: boolean;
	workspace?: boolean;
	className?: string;
} = $props();
let busy = $state(false);
let feedbackStatus = $state<WorkspaceFeedbackState | "idle">("idle");
let timer: ReturnType<typeof setTimeout>;
let mounted = true;
const queued = $derived(workspace && $workspaceSyncStatus.queueCount > 0);
const effective = $derived(
	busy
		? "submitting"
		: feedbackStatus === "pending" && !queued
			? "idle"
			: feedbackStatus,
);
const currentIcon = $derived(
	busy
		? sync
		: effective === "success"
			? check
			: ["attention", "error"].includes(effective)
				? alert
				: effective === "pending"
					? sync
					: icon,
);
async function run() {
	if (busy || disabled || queued) return;
	clearTimeout(timer);
	const previous = feedback;
	busy = true;
	feedbackStatus = "idle";
	try {
		await action();
		if (!mounted) return;
		if (feedback && feedback !== previous)
			feedbackStatus = feedback.feedbackState;
		if (feedbackStatus === "success")
			timer = setTimeout(() => {
				feedbackStatus = "idle";
			}, 1200);
	} catch {
		if (!mounted) return;
		feedbackStatus = "attention";
		showToast($t("Check synchronization status before retrying."), "info");
	} finally {
		if (mounted) busy = false;
	}
}
onDestroy(() => {
	mounted = false;
	clearTimeout(timer);
});
</script>

<button type="button" class={cn("gh-btn gh-action-button", variant === "primary" && "gh-btn-primary", variant === "danger" && "gh-btn-danger", className)} disabled={disabled || busy || queued} aria-busy={busy} data-feedback={effective} data-has-icon={icon ? "true" : undefined} onclick={run}>
	{#if currentIcon}<span class="gh-feedback-icon"><Octicon icon={currentIcon} className={cn("h-4 w-4", busy && "animate-spin")} /></span>{/if}
 <span class="gh-action-label">
  <span class:invisible={busy || effective === "pending"}>{label}</span>
  <span class="gh-action-progress" class:invisible={!busy} aria-hidden={!busy}>{busyLabel ?? $t("Saving...")}</span>
  <span class="gh-action-progress" class:invisible={effective !== "pending"} aria-hidden={effective !== "pending"}>{$t("Awaiting cloud")}</span>
 </span>
</button>
