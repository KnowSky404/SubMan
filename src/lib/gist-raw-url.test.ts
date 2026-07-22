import { expect, test } from "bun:test";
import { buildStableGistRawUrl } from "$lib/gist-raw-url";

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
