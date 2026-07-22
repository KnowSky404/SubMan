import { describe, expect, it } from "bun:test";
import { createWorkspaceGistGateway } from "$lib/server/workspace-gist";

const TOKEN = "secret-github-token";

function gistResponse() {
	return {
		id: "gist-1",
		owner: { login: "owner" },
		description: "SubMan-Data",
		updated_at: "2026-07-22T10:00:00.000Z",
		html_url: "https://gist.github.com/gist-1",
		files: {
			"subman.json": {
				filename: "subman.json",
				language: "JSON",
				size: 12,
				truncated: false,
				content: "workspace",
				raw_url: "https://gist.githubusercontent.com/raw/subman.json",
			},
			"large.txt": {
				filename: "large.txt",
				language: "Text",
				size: 5000,
				truncated: true,
				content: "partial",
				raw_url: "https://gist.githubusercontent.com/raw/large.txt",
			},
		},
	};
}

describe("Workspace Gist gateway", () => {
	it("loads exact requested contents and follows truncated raw files", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			requests.push({ url, init });
			if (url.endsWith("/raw/large.txt")) {
				return new Response("complete large content", { status: 200 });
			}
			return Response.json(gistResponse());
		};
		const gateway = createWorkspaceGistGateway(fetchImpl);

		const result = await gateway.read(TOKEN, "gist-1", [
			"subman.json",
			"large.txt",
			"missing.txt",
		]);

		expect(result.contents).toEqual({
			"subman.json": "workspace",
			"large.txt": "complete large content",
		});
		expect(result.gist.ownerLogin).toBe("owner");
		expect(requests.map((request) => request.url)).toEqual([
			"https://api.github.com/gists/gist-1",
			"https://gist.githubusercontent.com/raw/large.txt",
		]);
		expect(
			JSON.stringify(requests.map((request) => request.init?.headers)),
		).toContain(`Bearer ${TOKEN}`);
	});

	it("patches configuration, publication, and deletion in one request", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const gateway = createWorkspaceGistGateway(async (input, init) => {
			requests.push({ url: String(input), init });
			return Response.json(gistResponse());
		});

		await gateway.patch(TOKEN, "gist-1", {
			"subman.json": { content: "next" },
			"aggregate.txt": { content: "published" },
			"subman.bootstrap.json": null,
		});

		expect(requests[0]?.url).toBe("https://api.github.com/gists/gist-1");
		expect(requests[0]?.init?.method).toBe("PATCH");
		expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
			files: {
				"subman.json": { content: "next" },
				"aggregate.txt": { content: "published" },
				"subman.bootstrap.json": null,
			},
		});
	});

	it("does not include credentials in GitHub errors", async () => {
		const gateway = createWorkspaceGistGateway(async () =>
			Response.json(
				{ message: `request rejected for ${TOKEN}` },
				{ status: 401, statusText: "Unauthorized" },
			),
		);
		let message = "";
		try {
			await gateway.read(TOKEN, "gist-1", ["subman.json"]);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).toContain("401 Unauthorized");
		expect(message).not.toContain(TOKEN);
	});
});
