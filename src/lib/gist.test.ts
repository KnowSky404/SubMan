import { expect, test } from "bun:test";
import { listGists } from "$lib/gist";

function gistResponse(id: string) {
	return {
		id,
		description: "SubMan-Data",
		updated_at: "2026-07-22T00:00:00.000Z",
		html_url: `https://gist.github.com/${id}`,
		files: {},
	};
}

test("Gist pagination requests every page with per_page=100", async () => {
	const requests: string[] = [];
	const fetchImpl: typeof fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		const page = new URL(url).searchParams.get("page");
		const payload =
			page === "1"
				? Array.from({ length: 100 }, (_, index) =>
						gistResponse(`gist-${index}`),
					)
				: [gistResponse("gist-100")];
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};

	const result = await listGists("token", fetchImpl);

	expect(result).toHaveLength(101);
	expect(requests).toEqual([
		"https://api.github.com/gists?per_page=100&page=1",
		"https://api.github.com/gists?per_page=100&page=2",
	]);
	expect(result[100]?.id).toBe("gist-100");
});
