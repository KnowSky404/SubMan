export function navigationIndicator(node: HTMLElement) {
	let frame = 0;
	let ready = false;
	const measure = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const active = node.querySelector<HTMLElement>('[aria-current="page"]');
			if (!active) return;
			const anchor = active.getBoundingClientRect();
			const container = node.getBoundingClientRect();
			node.style.setProperty(
				"--nav-indicator-x",
				`${anchor.left - container.left + node.scrollLeft}px`,
			);
			node.style.setProperty("--nav-indicator-width", `${anchor.width}px`);
			node.dataset.indicatorReady = "true";
			if (ready) node.dataset.indicatorAnimated = "true";
			ready = true;
		});
	};
	const resize = new ResizeObserver(measure);
	resize.observe(node);
	for (const child of node.querySelectorAll("a")) resize.observe(child);
	const changes = new MutationObserver(measure);
	changes.observe(node, {
		subtree: true,
		attributes: true,
		attributeFilter: ["aria-current"],
		childList: true,
		characterData: true,
	});
	node.addEventListener("scroll", measure, { passive: true });
	measure();
	return {
		destroy() {
			cancelAnimationFrame(frame);
			resize.disconnect();
			changes.disconnect();
			node.removeEventListener("scroll", measure);
		},
	};
}
