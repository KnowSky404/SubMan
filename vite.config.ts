import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

function clearLegacyRollupOutputOption(): Plugin {
	const clearOutput = (output: unknown) => {
		if (!output) return;
		if (Array.isArray(output)) {
			for (const item of output) {
				if (item && typeof item === 'object') {
					delete (item as { codeSplitting?: unknown }).codeSplitting;
				}
			}
			return;
		}

		if (typeof output === 'object') {
			delete (output as { codeSplitting?: unknown }).codeSplitting;
		}
	};

	return {
		name: 'subman-clear-legacy-rollup-output-option',
		configResolved(config) {
			clearOutput(config.build.rollupOptions?.output);

			const environments = config.environments as Record<string, { build?: { rollupOptions?: { output?: unknown } } }> | undefined;
			if (!environments) return;

			for (const environment of Object.values(environments)) {
				clearOutput(environment.build?.rollupOptions?.output);
			}
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), clearLegacyRollupOutputOption()],
	ssr: {
		noExternal: ['lucide-svelte']
	}
});
