import { appendFileSync, existsSync } from "node:fs";
import adapter from "@sveltejs/adapter-cloudflare";

const WORKER_ENTRYPOINT = ".svelte-kit/cloudflare/_worker.js";

function adapterWithWorkspaceCoordinator() {
	const cloudflare = adapter();
	return {
		...cloudflare,
		name: `${cloudflare.name}-workspace-coordinator`,
		async adapt(builder) {
			await cloudflare.adapt(builder);
			if (!existsSync(WORKER_ENTRYPOINT)) {
				throw new Error(
					`Cloudflare adapter did not create ${WORKER_ENTRYPOINT}`,
				);
			}
			appendFileSync(
				WORKER_ENTRYPOINT,
				'\nexport { WorkspaceCoordinator } from "../../src/lib/server/workspace-coordinator.ts";\n',
			);
		},
	};
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapterWithWorkspaceCoordinator(),
	},
};

export default config;
