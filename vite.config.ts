import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

export const DEV_PORT_MIN = 8000;
export const DEV_PORT_MAX = 10000;

export function pickRandomDevPort(
	random = Math.random,
	min = DEV_PORT_MIN,
	max = DEV_PORT_MAX,
): number {
	return Math.floor(random() * (max - min + 1)) + min;
}

function clearLegacyRollupOutputOption(): Plugin {
	const clearOutput = (output: unknown) => {
		if (!output) return;
		if (Array.isArray(output)) {
			for (const item of output) {
				if (item && typeof item === "object") {
					delete (item as { codeSplitting?: unknown }).codeSplitting;
				}
			}
			return;
		}

		if (typeof output === "object") {
			delete (output as { codeSplitting?: unknown }).codeSplitting;
		}
	};

	return {
		name: "subman-clear-legacy-rollup-output-option",
		configResolved(config) {
			clearOutput(config.build.rollupOptions?.output);

			const environments = config.environments as
				| Record<string, { build?: { rollupOptions?: { output?: unknown } } }>
				| undefined;
			if (!environments) return;

			for (const environment of Object.values(environments)) {
				clearOutput(environment.build?.rollupOptions?.output);
			}
		},
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), clearLegacyRollupOutputOption()],
	server: {
		port: pickRandomDevPort(),
		strictPort: true,
	},
	ssr: {
		noExternal: ["lucide-svelte"],
	},
});
