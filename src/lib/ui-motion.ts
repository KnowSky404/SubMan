import { cubicOut } from "svelte/easing";
import { prefersReducedMotion } from "svelte/motion";
import { fade, slide, type TransitionConfig } from "svelte/transition";

export function motionDuration(duration = 180): number {
	return prefersReducedMotion.current ? 0 : duration;
}

export function surfaceMotion(
	node: Element,
	{ duration = 180, y = 8, scale = 0.98 } = {},
): TransitionConfig {
	if (prefersReducedMotion.current) return { duration: 0 };
	const style = getComputedStyle(node);
	const transform = style.transform === "none" ? "" : style.transform;
	const opacity = Number(style.opacity);
	return {
		duration,
		easing: cubicOut,
		css: (t, u) =>
			"opacity:" +
			t * opacity +
			";transform:" +
			transform +
			" translateY(" +
			u * y +
			"px) scale(" +
			(1 - u * (1 - scale)) +
			")",
	};
}

export function veilMotion(node: Element, { duration = 120 } = {}) {
	return fade(node, { duration: motionDuration(duration) });
}

export function collapseMotion(node: Element, { duration = 180 } = {}) {
	return slide(node, { duration: motionDuration(duration), easing: cubicOut });
}

export function animatePage(root: HTMLElement) {
	const node = root.querySelector<HTMLElement>(".gh-page");
	if (!node) return;
	for (const animation of node.getAnimations()) animation.cancel();
	if (prefersReducedMotion.current) return;
	const animation = node.animate(
		[
			{ opacity: 0, transform: "translateY(4px)" },
			{ opacity: 1, transform: "none" },
		],
		{ duration: 160, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
	);
	animation.id = "subman-page";
}

export function watchMotionPreference() {
	const query = matchMedia("(prefers-reduced-motion: reduce)");
	const finish = () => {
		if (!query.matches) return;
		for (const animation of document.getAnimations()) {
			const target = (animation.effect as KeyframeEffect | null)?.target;
			if (!(target instanceof Element) || !target.closest("[data-ui-motion]"))
				continue;
			if (animation.effect?.getComputedTiming().iterations === Infinity)
				continue;
			try {
				animation.finish();
			} catch {
				/* Already cancelled or unresolved. */
			}
		}
	};
	query.addEventListener("change", finish);
	return () => query.removeEventListener("change", finish);
}
