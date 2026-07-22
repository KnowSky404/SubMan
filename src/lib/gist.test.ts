import { expect, test } from "bun:test";
import { buildStableGistRawUrl } from "$lib/gist";
import { collectPages } from "$lib/github-pagination";

test("Gist pagination requests every page with per_page=100", async () => {
	const requests: Array<{ page: number; perPage: number }> = [];
	const result = await collectPages(async (page, perPage) => {
		requests.push({ page, perPage });
		return page === 1
			? Array.from({ length: 100 }, (_, index) => `gist-${index}`)
			: ["gist-100"];
	});

	expect(result).toHaveLength(101);
	expect(requests).toEqual([
		{ page: 1, perPage: 100 },
		{ page: 2, perPage: 100 },
	]);
});

test("stable raw URLs can be built before publishing a new file", () => {
	expect(
		buildStableGistRawUrl(
			{
				id: "gist-1",
				ownerLogin: "octocat",
				description: "SubMan-Data",
				files: [],
				updatedAt: "2026-07-22T00:00:00.000Z",
				url: "https://gist.github.com/gist-1",
			},
			"aggregate output.txt",
		),
	).toBe(
		"https://gist.githubusercontent.com/octocat/gist-1/raw/aggregate%20output.txt",
	);
});
