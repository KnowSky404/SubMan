import { motionDuration } from "$lib/ui-motion";

export function disclosure(node: HTMLDetailsElement) {
	const summary = node.querySelector("summary");
	let animation: Animation | undefined;
	let expanded = node.open;
	const overflow = node.style.overflow;
	const toggle = (event: MouseEvent) => {
		event.preventDefault();
		const start = node.getBoundingClientRect().height;
		expanded = animation ? !expanded : !node.open;
		animation?.cancel();
		if (!motionDuration()) {
			node.open = expanded;
			node.style.overflow = overflow;
			animation = undefined;
			return;
		}
		node.open = true;
		const style = getComputedStyle(node);
		const end = expanded
			? node.scrollHeight + 2
			: (summary?.offsetHeight ?? 0) +
				Number.parseFloat(style.paddingTop) +
				Number.parseFloat(style.paddingBottom) +
				2;
		node.style.overflow = "hidden";
		const current = node.animate(
			[{ height: `${start}px` }, { height: `${end}px` }],
			{
				duration: 180,
				easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
			},
		);
		animation = current;
		void current.finished
			.then(() => {
				if (animation !== current) return;
				node.open = expanded;
				node.style.overflow = overflow;
				animation = undefined;
			})
			.catch(() => {});
	};
	summary?.addEventListener("click", toggle);
	return {
		destroy() {
			animation?.cancel();
			summary?.removeEventListener("click", toggle);
		},
	};
}
