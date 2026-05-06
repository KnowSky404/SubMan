import { env as privateEnv } from "$env/dynamic/private";

export type ServerApiEnv = {
	githubToken?: string;
	submanApiToken?: string;
};

export function getServerApiEnv(
	platform: App.Platform | undefined,
): ServerApiEnv {
	return {
		githubToken: platform?.env?.GITHUB_TOKEN ?? privateEnv.GITHUB_TOKEN,
		submanApiToken:
			platform?.env?.SUBMAN_API_TOKEN ?? privateEnv.SUBMAN_API_TOKEN,
	};
}
