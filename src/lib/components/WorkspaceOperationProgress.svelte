<script lang="ts">
import { get } from "svelte/store";
import { beforeNavigate } from "$app/navigation";
import Dialog from "$lib/components/Dialog.svelte";
import Octicon from "$lib/components/Octicon.svelte";
import { t } from "$lib/i18n";
import { sync } from "$lib/octicons";
import { confirmDialog } from "$lib/stores/confirm";
import { workspaceOperationProgress } from "$lib/workspace-operation-progress";

beforeNavigate(({ cancel }) => {
	if (get(workspaceOperationProgress)) cancel();
});
</script>

{#if $workspaceOperationProgress && !$confirmDialog.open}
	<Dialog labelledby="workspace-operation-title" closeLabel={$t("Close dialog")} onclose={() => {}} dismissible={false} busy={true} className="max-w-md" mobileSheet={false}>
		<div class="gh-section-body flex items-start gap-4" aria-busy="true" role="status">
			<Octicon icon={sync} className="mt-0.5 h-6 w-6 shrink-0 animate-spin text-accent-fg" />
			<div class="space-y-2">
				<h2 id="workspace-operation-title" class="text-base font-semibold">{$t($workspaceOperationProgress.messageKey)}</h2>
				<p class="text-sm text-fg-muted">{$t("Please wait for this operation to finish before making more changes.")}</p>
			</div>
		</div>
	</Dialog>
{/if}
