import { getServerApiEnv } from "$lib/server/api/env";

export function GET({ platform }: { platform?: App.Platform }) {
	const env = getServerApiEnv(platform);

	return Response.json({
		ok: Boolean(env.githubToken && env.submanApiToken),
		config: {
			githubToken: Boolean(env.githubToken),
			submanApiToken: Boolean(env.submanApiToken),
		},
	});
}
