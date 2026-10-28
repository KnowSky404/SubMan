import { tick } from "svelte";

type ModalOptions = { onclose: () => void; initialFocus?: string };
const layers: HTMLElement[] = [];
const inertCounts = new Map<
	HTMLElement,
	{ count: number; original: boolean }
>();
let originalOverflow = "";
let originalRootOverflow = "";

function focusable(surface: HTMLElement | null) {
	return Array.from(
		surface?.querySelectorAll<HTMLElement>(
			'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
		) ?? [],
	).filter(
		(element) =>
			element.getClientRects().length > 0 &&
			!element.matches(":disabled") &&
			!element.closest("[inert]"),
	);
}

export function handleModalKeydown(event: KeyboardEvent, onclose: () => void) {
	const surface = event.currentTarget as HTMLElement;
	const node = surface.closest<HTMLElement>(".gh-dialog-layer");
	if (layers.at(-1) !== node || event.defaultPrevented) return;
	if (event.key === "Escape") {
		event.preventDefault();
		onclose();
	} else if (event.key === "Tab") {
		const items = focusable(surface);
		const first = items[0];
		const last = items.at(-1);
		if (!first) {
			event.preventDefault();
			surface.focus();
		} else if (
			event.shiftKey &&
			(document.activeElement === first || document.activeElement === surface)
		) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
}

export function modal(node: HTMLElement, options: ModalOptions) {
	const returnFocus =
		document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
	const surface = node.querySelector<HTMLElement>('[role="dialog"]');
	const hidden: HTMLElement[] = [];
	let mounted = true;
	if (!layers.length) {
		originalOverflow = document.body.style.overflow;
		originalRootOverflow = document.documentElement.style.overflow;
		document.documentElement.style.overflow = "hidden";
		document.body.style.overflow = "hidden";
	}
	layers.push(node);
	let branch: HTMLElement = node;
	while (branch.parentElement) {
		for (const sibling of branch.parentElement.children) {
			if (
				!(sibling instanceof HTMLElement) ||
				sibling === branch ||
				sibling.tagName === "SCRIPT"
			)
				continue;
			const entry = inertCounts.get(sibling) ?? {
				count: 0,
				original: sibling.inert,
			};
			entry.count++;
			inertCounts.set(sibling, entry);
			sibling.inert = true;
			hidden.push(sibling);
		}
		branch = branch.parentElement;
		if (branch === document.body) break;
	}
	const viewport = window.visualViewport;
	const updateViewport = () => {
		node.style.setProperty(
			"--dialog-viewport-height",
			`${viewport?.height ?? innerHeight}px`,
		);
		node.style.setProperty(
			"--dialog-viewport-top",
			`${viewport?.offsetTop ?? 0}px`,
		);
	};
	viewport?.addEventListener("resize", updateViewport);
	viewport?.addEventListener("scroll", updateViewport);
	updateViewport();
	void tick().then(() => {
		if (!mounted || layers.at(-1) !== node) return;
		const initial = surface?.querySelector<HTMLElement>(
			options.initialFocus ??
				"input:not(:disabled), textarea:not(:disabled), select:not(:disabled)",
		);
		(initial ?? focusable(surface)[0] ?? surface)?.focus();
	});
	return {
		update(next: ModalOptions) {
			options = next;
		},
		destroy() {
			mounted = false;
			viewport?.removeEventListener("resize", updateViewport);
			viewport?.removeEventListener("scroll", updateViewport);
			layers.splice(layers.indexOf(node), 1);
			for (const element of hidden) {
				const entry = inertCounts.get(element);
				if (!entry || --entry.count) continue;
				element.inert = entry.original;
				inertCounts.delete(element);
			}
			if (!layers.length) {
				document.body.style.overflow = originalOverflow;
				document.documentElement.style.overflow = originalRootOverflow;
			}
			if (returnFocus?.isConnected && !returnFocus.closest("[inert]"))
				returnFocus.focus();
		},
	};
}
