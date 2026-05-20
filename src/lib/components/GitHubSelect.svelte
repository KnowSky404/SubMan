<script lang="ts">
import { slide } from "svelte/transition";
import { cn } from "$lib/utils/cn";

export type GitHubSelectOption = {
	value: string;
	label: string;
	description?: string;
	badge?: string;
	disabled?: boolean;
};

interface Props {
	id?: string;
	value?: string;
	options: GitHubSelectOption[];
	placeholder?: string;
	ariaLabel?: string;
	buttonClass?: string;
	menuClass?: string;
	activeLabel?: string;
	disabled?: boolean;
	onValueChange?: (value: string) => void;
}

let {
	id,
	value = $bindable(""),
	options,
	placeholder = "",
	ariaLabel,
	buttonClass = "gh-select w-full",
	menuClass = "left-0 top-full w-full",
	activeLabel = "Active",
	disabled = false,
	onValueChange,
}: Props = $props();

let open = $state(false);
let selectedOption = $derived(
	options.find((option) => option.value === value) ?? null,
);
let label = $derived(selectedOption?.label ?? placeholder);

function selectValue(nextValue: string) {
	value = nextValue;
	open = false;
	onValueChange?.(nextValue);
}
</script>

<div class="relative min-w-0">
	<button
		{id}
		type="button"
		class={cn(buttonClass, "flex items-center justify-between text-left")}
		onclick={() => (open = !open)}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label={ariaLabel}
		{disabled}
	>
		<span class={cn("min-w-0 truncate", !selectedOption && "text-fg-muted")}>
			{label}
		</span>
	</button>
	{#if open}
		<button
			type="button"
			class="fixed inset-0 z-[110]"
			onclick={() => (open = false)}
			aria-label="Close menu"
		></button>
		<div class={cn("gh-dropdown-menu", menuClass)} transition:slide={{ duration: 150 }}>
			<div class="gh-dropdown-body flex flex-col gap-0.5">
				{#each options as option}
					<button
						type="button"
						class={cn(
							"gh-dropdown-item",
							value === option.value ? "font-semibold text-fg-default" : "text-fg-default",
							option.disabled && "cursor-not-allowed opacity-60",
						)}
						onclick={() => !option.disabled && selectValue(option.value)}
						disabled={option.disabled}
					>
						<span class="min-w-0 flex-1 truncate">{option.label}</span>
						{#if option.badge}
							<span class="gh-label">{option.badge}</span>
						{:else if value === option.value}
							<span class="gh-label">{activeLabel}</span>
						{/if}
						{#if option.description}
							<span class="sr-only">{option.description}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
