import { describe, expect, it } from "bun:test";
import { readBoundedJson } from "$lib/server/api/bounded-json";
import { ApiError } from "$lib/server/api/errors";

async function expectApiError(
	promise: Promise<unknown>,
	status: number,
	code: string,
): Promise<void> {
	try {
		await promise;
		throw new Error("Expected an API error");
	} catch (error) {
		expect(error instanceof ApiError).toBe(true);
		expect((error as ApiError).status).toBe(status);
		expect((error as ApiError).code).toBe(code);
	}
}

describe("bounded JSON request reader", () => {
	it("accepts JSON media types and a body exactly at the byte limit", async () => {
		const body = '{"ok":true}';
		const request = new Request("https://subman.test/api", {
			method: "POST",
			headers: { "Content-Type": "application/problem+json; charset=utf-8" },
			body,
		});

		expect(
			await readBoundedJson(request, new TextEncoder().encode(body).length),
		).toEqual({ ok: true });
	});

	it("rejects a missing or incorrect content type", async () => {
		for (const contentType of [null, "text/plain"]) {
			const headers = contentType ? { "Content-Type": contentType } : undefined;
			await expectApiError(
				readBoundedJson(
					new Request("https://subman.test/api", {
						method: "POST",
						headers,
						body: "{}",
					}),
				),
				415,
				"unsupported_media_type",
			);
		}
	});

	it("rejects malformed JSON and invalid UTF-8", async () => {
		for (const body of ["{", new Uint8Array([0xff])]) {
			await expectApiError(
				readBoundedJson(
					new Request("https://subman.test/api", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body,
					}),
				),
				400,
				"invalid_json",
			);
		}
	});

	it("rejects a declared body larger than the limit", async () => {
		await expectApiError(
			readBoundedJson(
				new Request("https://subman.test/api", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": "9",
					},
					body: "{}",
				}),
				8,
			),
			413,
			"payload_too_large",
		);
	});

	it("counts chunked bodies instead of trusting Content-Length", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"a":'));
				controller.enqueue(new TextEncoder().encode('"overflow"}'));
				controller.close();
			},
		});
		const requestInit: RequestInit & { duplex: "half" } = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: stream,
			duplex: "half",
		};
		const request = new Request("https://subman.test/api", requestInit);

		await expectApiError(readBoundedJson(request, 8), 413, "payload_too_large");
	});
});
