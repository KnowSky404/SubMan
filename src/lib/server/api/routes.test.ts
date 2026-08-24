import * as bunTest from "bun:test";

const { describe, expect, it } = bunTest;
const bun = bunTest as unknown as {
	mock: {
		module: (specifier: string, factory: () => unknown) => void;
	};
};

bun.mock.module("$env/dynamic/private", () => ({ env: {} }));

describe("Server API error logging", () => {
	it("does not expose credentials from unknown errors in logs or responses", async () => {
		const { handleApiError } = await import("$lib/server/api/routes");
		const token = "github-token-that-must-not-be-logged";
		const logged: unknown[][] = [];
		const originalError = console.error;
		console.error = (...values: unknown[]) => {
			logged.push(values);
		};

		let response: Response;
		try {
			response = handleApiError(new Error(`upstream echoed ${token}`));
		} finally {
			console.error = originalError;
		}

		const body = await response.text();
		expect(response.status).toBe(500);
		expect(JSON.stringify(logged)).not.toContain(token);
		expect(body).not.toContain(token);
		expect(logged).toEqual([
			[
				JSON.stringify({
					source: "subman",
					event: "api.request.unhandled",
					operation: "server-api",
					errorCode: "unhandled-error",
				}),
			],
		]);
	});

	it("returns stable dispositions and safe retry metadata", async () => {
		const { ApiError } = await import("$lib/server/api/errors");
		const { handleApiError } = await import("$lib/server/api/routes");
		const response = handleApiError(
			new ApiError(429, "gist_write_failed", "GitHub rate limited the write", {
				gateway: {
					operation: "gist.patch",
					status: 429,
					category: "rate-limit",
					requestId: "request-1",
					retryAfter: 60,
					rateLimitReset: 1_780_000_000,
				},
				revision: 7,
			}),
		);

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("60");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			error: {
				code: "gist_write_failed",
				message: "GitHub rate limited the write",
				disposition: "retryable-upstream",
				gateway: {
					operation: "gist.patch",
					status: 429,
					category: "rate-limit",
					requestId: "request-1",
					retryAfter: 60,
					rateLimitReset: 1_780_000_000,
				},
			},
			workspace: { revision: 7 },
		});
	});
});

describe("Server API revision contract", () => {
	it("adds revision headers to successful workspace responses", async () => {
		const { workspaceJson } = await import("$lib/server/api/routes");
		const response = workspaceJson({ data: [] }, 12);

		expect(response.headers.get("etag")).toBe('"subman-revision-12"');
		expect(response.headers.get("x-subman-revision")).toBe("12");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("accepts the current strong ETag and rejects stale preconditions", async () => {
		const { assertWorkspacePrecondition } = await import(
			"$lib/server/api/routes"
		);
		const { ApiError } = await import("$lib/server/api/errors");

		assertWorkspacePrecondition(
			new Request("https://subman.example/api/nodes", {
				headers: { "If-Match": '"subman-revision-4"' },
			}),
			4,
		);
		assertWorkspacePrecondition(
			new Request("https://subman.example/api/nodes", {
				headers: { "If-Match": "*" },
			}),
			4,
		);

		let failure: unknown;
		try {
			assertWorkspacePrecondition(
				new Request("https://subman.example/api/nodes", {
					headers: { "If-Match": 'W/"subman-revision-3"' },
				}),
				4,
			);
		} catch (error) {
			failure = error;
		}
		expect(failure instanceof ApiError).toBe(true);
		expect((failure as { status?: number }).status).toBe(412);
		expect((failure as { code?: string }).code).toBe("precondition_failed");
		expect((failure as { details?: unknown }).details).toEqual({ revision: 4 });
	});
});
