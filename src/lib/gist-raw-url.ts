import type { GistMeta } from "$lib/models";

export function toStableGistRawUrl(rawUrl?: string | null): string | undefined {
	if (!rawUrl) {
		return undefined;
	}

	try {
		const url = new URL(rawUrl);
		const segments = url.pathname.split("/").filter(Boolean);
		const rawIndex = segments.indexOf("raw");

		if (
			url.hostname !== "gist.githubusercontent.com" ||
			rawIndex < 0 ||
			segments.length <= rawIndex + 2
		) {
			return rawUrl;
		}

		url.pathname = `/${[...segments.slice(0, rawIndex + 1), ...segments.slice(rawIndex + 2)].join("/")}`;
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return rawUrl;
	}
}

export function buildStableGistRawUrl(
	gist: GistMeta,
	fileName: string,
): string | null {
	if (gist.ownerLogin) {
		return `https://gist.githubusercontent.com/${encodeURIComponent(gist.ownerLogin)}/${encodeURIComponent(gist.id)}/raw/${encodeURIComponent(fileName)}`;
	}
	return (
		toStableGistRawUrl(
			gist.files.find((file) => file.filename === fileName)?.rawUrl,
		) ?? null
	);
}
