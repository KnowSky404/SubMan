// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env?: Env & {
				GITHUB_TOKEN?: string;
				SUBMAN_API_TOKEN?: string;
				SUBMAN_MCP_GIST_ID?: string;
				SUBMAN_MCP_READ_TOKEN?: string;
				SUBMAN_MCP_WRITE_TOKEN?: string;
				WORKSPACE_COORDINATOR: DurableObjectNamespace<
					import("$lib/server/workspace-coordinator").WorkspaceCoordinator
				>;
			};
		}
	}
}

export {};
