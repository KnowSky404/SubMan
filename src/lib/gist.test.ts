import { expect, test } from "bun:test";
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
