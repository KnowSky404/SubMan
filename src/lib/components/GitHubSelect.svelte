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
let buttonElement = $state<HTMLButtonElement | null>(null);
let selectedOption = $derived(
	options.find((option) => option.value === value) ?? null,
);
let label = $derived(selectedOption?.label ?? placeholder);

function focusMenuOption(offset: number): void {
	const menu =
		buttonElement?.parentElement?.querySelector<HTMLElement>('[role="menu"]');
	if (!menu) return;
	const items = Array.from(
		menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
	).filter((item) => !item.disabled);
	if (items.length === 0) return;
	const currentIndex = items.indexOf(
		document.activeElement as HTMLButtonElement,
	);
	const nextIndex =
		currentIndex < 0
			? offset > 0
				? 0
				: items.length - 1
			: (currentIndex + offset + items.length) % items.length;
	items[nextIndex]?.focus();
}

function openMenu(): void {
	open = true;
	void Promise.resolve().then(() => focusMenuOption(1));
}

function closeMenu(returnFocus = true): void {
	open = false;
	if (returnFocus) buttonElement?.focus();
}

function handleButtonKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape" && open) {
		event.preventDefault();
		closeMenu();
		return;
	}
	if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) return;
	event.preventDefault();
	if (!open) {
		openMenu();
		return;
	}
	focusMenuOption(event.key === "ArrowUp" ? -1 : 1);
}

function handleMenuKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape") {
		event.preventDefault();
		closeMenu();
		return;
	}
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		focusMenuOption(event.key === "ArrowUp" ? -1 : 1);
		return;
	}
	if (event.key === "Home" || event.key === "End") {
		event.preventDefault();
		const menu =
			buttonElement?.parentElement?.querySelector<HTMLElement>('[role="menu"]');
		const items = Array.from(
			menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
		).filter((item) => !item.disabled);
		(
			items[event.key === "Home" ? 0 : items.length - 1] as
				| HTMLElement
				| undefined
		)?.focus();
	}
}

function selectValue(nextValue: string) {
	value = nextValue;
	open = false;
	onValueChange?.(nextValue);
}
</script>

<div class="relative min-w-0">
	<button
		bind:this={buttonElement}
		{id}
		type="button"
		class={cn(buttonClass, "flex items-center justify-between text-left")}
		onclick={() => (open ? closeMenu(false) : openMenu())}
		onkeydown={handleButtonKeydown}
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
			onclick={() => closeMenu()}
			aria-label="Close menu"
		></button>
		<div
			class={cn("gh-dropdown-menu", menuClass)}
			role="menu"
			tabindex="-1"
			onkeydown={handleMenuKeydown}
			transition:slide={{ duration: 150 }}
		>
			<div class="gh-dropdown-body flex flex-col gap-0.5">
				{#each options as option}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={value === option.value}
						tabindex={value === option.value ? 0 : -1}
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
