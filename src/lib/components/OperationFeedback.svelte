<script lang="ts">
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import { alert, sync } from "$lib/octicons";
import type { WorkspaceOperationPresentation } from "$lib/workspace-operation-presenter";

let { feedback }: { feedback: WorkspaceOperationPresentation | null } =
	$props();
</script>

{#if feedback && feedback.feedbackState !== "success"}
	<p class="gh-operation-feedback" data-feedback={feedback.feedbackState} role="status">
		<Octicon icon={feedback.feedbackState === "pending" ? sync : alert} className="h-4 w-4 shrink-0" />
		<span>{$t(feedback.messageKey, feedback.messageParams)}</span>
	</p>
{/if}
