/* eslint-disable */
// Curated from `wrangler types --include-runtime false`. The generated
// mainModule import is intentionally omitted because it makes svelte-check
// type-check generated .svelte-kit JavaScript.
declare namespace Cloudflare {
	interface GlobalProps {
		durableNamespaces: "WorkspaceCoordinator";
	}
	interface Env {
		ASSETS: Fetcher;
		WORKSPACE_COORDINATOR: DurableObjectNamespace<
			import("./lib/server/workspace-coordinator").WorkspaceCoordinator
		>;
	}
}
interface Env extends Cloudflare.Env {}
