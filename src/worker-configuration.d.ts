/* eslint-disable */
// Generated from wrangler.toml, with the built-worker import removed so
// svelte-check does not type-check generated .svelte-kit JavaScript.
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
