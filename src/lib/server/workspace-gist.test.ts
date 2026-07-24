import { describe, expect, it } from "bun:test";
import {
	createWorkspaceGistGateway,
	GITHUB_RESPONSE_BYTE_LIMITS,
	GitHubGatewayError,
	type GitHubGatewayErrorCategory,
} from "$lib/server/workspace-gist";

const TOKEN = "secret-github-token";
const encoder = new TextEncoder();

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

function gistJsonWithByteLength(byteLength: number): string {
	const base = JSON.stringify({ ...gistResponse(), padding: "" });
	const baseBytes = encoder.encode(base).byteLength;
	if (byteLength < baseBytes)
		throw new Error("Target byte length is too small");
	return JSON.stringify({
		...gistResponse(),
		padding: "x".repeat(byteLength - baseBytes),
	});
}

function chunkedResponse(
	chunks: Uint8Array[],
	init: ResponseInit = {},
): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		}),
		init,
	);
}

async function gatewayError(
	promise: Promise<unknown>,
): Promise<GitHubGatewayError> {
	try {
		await promise;
		throw new Error("Expected GitHub gateway request to fail");
	} catch (error) {
		expect(error instanceof GitHubGatewayError).toBe(true);
		return error as GitHubGatewayError;
	}
}

function abortableFetch(): typeof fetch {
	return async (_input, init) =>
		new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => {
				reject(new Error(`aborted request containing ${TOKEN}`));
			});
		});
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

	it("accepts metadata exactly at its byte limit", async () => {
		const body = gistJsonWithByteLength(
			GITHUB_RESPONSE_BYTE_LIMITS.gistMetadata,
		);
		const gateway = createWorkspaceGistGateway(async () =>
			chunkedResponse([encoder.encode(body)]),
		);

		const result = await gateway.read(TOKEN, "gist-1", ["subman.json"]);

		expect(result.gist.id).toBe("gist-1");
		expect(result.contents["subman.json"]).toBe("workspace");
	});

	it("counts chunked raw bytes and decodes UTF-8 split across chunks", async () => {
		const requests: string[] = [];
		const expected = "prefix-\u20ac-suffix";
		const bytes = encoder.encode(expected);
		const euroStart = encoder.encode("prefix-").byteLength;
		const gateway = createWorkspaceGistGateway(async (input) => {
			const url = String(input);
			requests.push(url);
			return url.endsWith("/raw/large.txt")
				? chunkedResponse([
						bytes.slice(0, euroStart + 1),
						bytes.slice(euroStart + 1),
					])
				: Response.json(gistResponse());
		});

		const result = await gateway.read(TOKEN, "gist-1", ["large.txt"]);

		expect(result.contents["large.txt"]).toBe(expected);
		expect(requests).toHaveLength(2);
	});

	it("rejects one raw byte over the limit and permits a later operation", async () => {
		let rawCalls = 0;
		const gateway = createWorkspaceGistGateway(async (input) => {
			if (!String(input).endsWith("/raw/large.txt")) {
				return Response.json(gistResponse());
			}
			rawCalls += 1;
			return rawCalls === 1
				? chunkedResponse(
						[
							new Uint8Array(GITHUB_RESPONSE_BYTE_LIMITS.gistRawFile),
							new Uint8Array(1),
						],
						{
							headers: {
								"X-GitHub-Request-Id": "RAW:LIMIT",
								"Retry-After": "7",
							},
						},
					)
				: new Response("later content");
		});

		const error = await gatewayError(
			gateway.read(TOKEN, "gist-1", ["large.txt"]),
		);
		expect(error.toJSON()).toEqual({
			operation: "gist.raw.read",
			status: 200,
			category: "invalid-response",
			requestId: "RAW:LIMIT",
			retryAfter: 7,
			rateLimitReset: null,
		});

		const later = await gateway.read(TOKEN, "gist-1", ["large.txt"]);
		expect(later.contents["large.txt"]).toBe("later content");
	});

	it("bounds metadata and PATCH response bodies independently", async () => {
		const metadataGateway = createWorkspaceGistGateway(async () =>
			chunkedResponse([
				new Uint8Array(GITHUB_RESPONSE_BYTE_LIMITS.gistMetadata),
				new Uint8Array(1),
			]),
		);
		const metadataError = await gatewayError(
			metadataGateway.read(TOKEN, "gist-1"),
		);
		expect(metadataError.operation).toBe("gist.read");
		expect(metadataError.category).toBe("invalid-response");

		const patchGateway = createWorkspaceGistGateway(async () =>
			chunkedResponse([
				new Uint8Array(GITHUB_RESPONSE_BYTE_LIMITS.gistPatch),
				new Uint8Array(1),
			]),
		);
		const patchError = await gatewayError(
			patchGateway.patch(TOKEN, "gist-1", {
				"subman.json": { content: "next" },
			}),
		);
		expect(patchError.operation).toBe("gist.patch");
		expect(patchError.category).toBe("invalid-response");
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

	it("classifies GitHub statuses without reading or exposing response bodies", async () => {
		for (const [status, category] of [
			[401, "authentication"],
			[403, "authorization"],
			[404, "not-found"],
			[409, "conflict"],
			[422, "validation"],
			[429, "rate-limit"],
			[503, "upstream"],
		] as const satisfies readonly (readonly [
			number,
			GitHubGatewayErrorCategory,
		])[]) {
			const gateway = createWorkspaceGistGateway(async () =>
				Response.json(
					{ message: `request rejected for ${TOKEN}` },
					{ status, statusText: "unsafe upstream text" },
				),
			);
			const error = await gatewayError(
				gateway.read(TOKEN, "gist-1", ["subman.json"]),
			);

			expect(error.status).toBe(status);
			expect(error.category).toBe(category);
			expect(error.message).not.toContain(TOKEN);
			expect(error.message).not.toContain("unsafe upstream text");
			expect(JSON.stringify(error)).not.toContain(TOKEN);
		}
	});

	it("normalizes safe retry and GitHub request metadata", async () => {
		const gateway = createWorkspaceGistGateway(
			async () =>
				new Response(`unsafe ${TOKEN}`, {
					status: 429,
					headers: {
						"Retry-After": "120",
						"X-RateLimit-Reset": "1780000000",
						"X-GitHub-Request-Id": "ABCD:1234",
					},
				}),
		);
		const error = await gatewayError(
			gateway.read(TOKEN, "gist-1", ["subman.json"]),
		);

		expect(error.toJSON()).toEqual({
			operation: "gist.read",
			status: 429,
			category: "rate-limit",
			requestId: "ABCD:1234",
			retryAfter: 120,
			rateLimitReset: 1780000000,
		});
		expect(JSON.stringify(error)).not.toContain(TOKEN);
	});

	it("distinguishes authorization from primary and secondary 403 rate limits", async () => {
		for (const testCase of [
			{
				name: "authorization",
				headers: {
					"X-RateLimit-Remaining": "4999",
					"X-RateLimit-Reset": "1780000000",
				},
				category: "authorization",
				retryAfter: null,
			},
			{
				name: "primary rate limit",
				headers: {
					"X-RateLimit-Remaining": "0",
					"X-RateLimit-Reset": "1780000000",
				},
				category: "rate-limit",
				retryAfter: null,
			},
			{
				name: "secondary rate limit",
				headers: {
					"Retry-After": "60",
					"X-RateLimit-Remaining": "4999",
					"X-RateLimit-Reset": "1780000000",
				},
				category: "rate-limit",
				retryAfter: 60,
			},
		] as const) {
			const gateway = createWorkspaceGistGateway(
				async () =>
					new Response(`unsafe ${testCase.name} body containing ${TOKEN}`, {
						status: 403,
						headers: testCase.headers,
					}),
			);
			const error = await gatewayError(
				gateway.read(TOKEN, "gist-1", ["subman.json"]),
			);

			expect(error.toJSON()).toEqual({
				operation: "gist.read",
				status: 403,
				category: testCase.category,
				requestId: null,
				retryAfter: testCase.retryAfter,
				rateLimitReset: 1780000000,
			});
			expect(error.message).not.toContain(TOKEN);
			expect(JSON.stringify(error)).not.toContain(TOKEN);
		}
	});

	it("times out Gist reads, truncated raw reads, and patches", async () => {
		const readError = await gatewayError(
			createWorkspaceGistGateway(abortableFetch(), { timeoutMs: 5 }).read(
				TOKEN,
				"gist-1",
			),
		);
		expect(readError.toJSON()).toEqual({
			operation: "gist.read",
			status: null,
			category: "timeout",
			requestId: null,
			retryAfter: null,
			rateLimitReset: null,
		});

		let calls = 0;
		const rawError = await gatewayError(
			createWorkspaceGistGateway(
				async (input, init) => {
					calls += 1;
					return calls === 1
						? Response.json(gistResponse())
						: abortableFetch()(input, init);
				},
				{ timeoutMs: 5 },
			).read(TOKEN, "gist-1", ["large.txt"]),
		);
		expect(rawError.category).toBe("timeout");
		expect(rawError.operation).toBe("gist.raw.read");

		const patchError = await gatewayError(
			createWorkspaceGistGateway(abortableFetch(), { timeoutMs: 5 }).patch(
				TOKEN,
				"gist-1",
				{ "subman.json": { content: "next" } },
			),
		);
		expect(patchError.category).toBe("timeout");
		expect(patchError.operation).toBe("gist.patch");
	});

	it("times out while reading a response body and permits a later operation", async () => {
		let calls = 0;
		const gateway = createWorkspaceGistGateway(
			async (_input, init) => {
				calls += 1;
				if (calls > 1) return Response.json(gistResponse());
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							init?.signal?.addEventListener("abort", () => {
								controller.error(new Error(`aborted body containing ${TOKEN}`));
							});
						},
					}),
				);
			},
			{ timeoutMs: 5 },
		);

		const error = await gatewayError(gateway.read(TOKEN, "gist-1"));
		expect(error.category).toBe("timeout");
		expect(error.message).not.toContain(TOKEN);

		const later = await gateway.read(TOKEN, "gist-1", ["subman.json"]);
		expect(later.contents["subman.json"]).toBe("workspace");
	});
});
