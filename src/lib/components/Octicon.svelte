<script lang="ts">
type OcticonLike = {
	toSVG: (options?: Record<string, string | number>) => string;
};

interface Props {
	icon: OcticonLike;
	size?: number;
	className?: string;
	label?: string;
}

let { icon, size = 16, className = "", label }: Props = $props();

const trustedOptions = (value: Record<string, string | number>) => value;

let svg = $derived(
	icon.toSVG(
		trustedOptions({
			height: size,
			width: size,
			class: className,
			...(label ? { "aria-label": label } : {}),
		}),
	),
);
</script>

{@html svg}
