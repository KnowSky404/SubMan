let nextTooltipId = 0;

/** Add a short label to an interactive element without a native-title duplicate. */
export function tooltip(node: HTMLElement, initialLabel: string) {
	let label = initialLabel;
	let bubble: HTMLDivElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let hovered = false;
	let focused = false;
	let dismissed = false;
	const id = `subman-tooltip-${++nextTooltipId}`;
	const nativeTitle = node.getAttribute("title");
	node.removeAttribute("title");

	function position() {
		if (!bubble) return;
		const anchor = node.getBoundingClientRect();
		const bounds = bubble.getBoundingClientRect();
		const left = Math.max(
			8,
			Math.min(
				anchor.left + anchor.width / 2 - bounds.width / 2,
				window.innerWidth - bounds.width - 8,
			),
		);
		const below = anchor.bottom + 8;
		const top =
			below + bounds.height <= window.innerHeight - 8
				? below
				: Math.max(8, anchor.top - bounds.height - 8);
		bubble.style.left = `${left}px`;
		bubble.style.top = `${top}px`;
	}

	function hide() {
		clearTimeout(timer);
		if (!bubble) return;
		document.removeEventListener("keydown", keydown);
		window.removeEventListener("resize", position);
		document.removeEventListener("scroll", hide, true);
		bubble.remove();
		bubble = null;
		const descriptions = (node.getAttribute("aria-describedby") ?? "")
			.split(/\s+/)
			.filter((value) => value && value !== id);
		if (descriptions.length)
			node.setAttribute("aria-describedby", descriptions.join(" "));
		else node.removeAttribute("aria-describedby");
	}

	function show() {
		clearTimeout(timer);
		if (!label || dismissed || bubble || (!hovered && !focused)) return;
		bubble = document.createElement("div");
		bubble.id = id;
		bubble.className = "gh-tooltip";
		bubble.setAttribute("role", "tooltip");
		bubble.textContent = label;
		bubble.addEventListener("pointerenter", () => clearTimeout(timer));
		bubble.addEventListener("pointerleave", scheduleHide);
		document.body.appendChild(bubble);
		document.addEventListener("keydown", keydown);
		window.addEventListener("resize", position);
		document.addEventListener("scroll", hide, true);
		node.setAttribute(
			"aria-describedby",
			[node.getAttribute("aria-describedby"), id].filter(Boolean).join(" "),
		);
		position();
	}

	function scheduleHide() {
		clearTimeout(timer);
		if (!focused && !hovered) timer = setTimeout(hide, 120);
	}

	function enter(event: PointerEvent) {
		if (event.pointerType === "touch") return;
		hovered = true;
		dismissed = false;
		clearTimeout(timer);
		timer = setTimeout(show, 350);
	}
	function leave() {
		hovered = false;
		dismissed = false;
		scheduleHide();
	}
	function focus() {
		focused = true;
		dismissed = false;
		show();
	}
	function blur() {
		focused = false;
		dismissed = false;
		scheduleHide();
	}
	function dismiss() {
		dismissed = true;
		hide();
	}
	function keydown(event: KeyboardEvent) {
		if (event.key === "Escape") dismiss();
	}
	node.addEventListener("pointerenter", enter);
	node.addEventListener("pointerleave", leave);
	node.addEventListener("focus", focus);
	node.addEventListener("blur", blur);
	node.addEventListener("click", dismiss);

	return {
		update(nextLabel: string) {
			label = nextLabel;
			node.removeAttribute("title");
			if (!label) hide();
			if (bubble) {
				bubble.textContent = label;
				position();
			}
		},
		destroy() {
			hide();
			node.removeEventListener("pointerenter", enter);
			node.removeEventListener("pointerleave", leave);
			node.removeEventListener("focus", focus);
			node.removeEventListener("blur", blur);
			node.removeEventListener("click", dismiss);
			if (nativeTitle !== null) node.setAttribute("title", nativeTitle);
		},
	};
}
