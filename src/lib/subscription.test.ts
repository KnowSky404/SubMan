import { describe, expect, it } from "bun:test";
import {
	decodeBase64Utf8,
	loadSubscriptionContent,
	type SubscriptionFetchImpl,
} from "./subscription";

const URL = "https://subscription.example/list";

function response(body: string, status = 200, headers?: HeadersInit): Response {
	return new Response(body, { status, headers });
}

describe("subscription fetch reliability", () => {
	it("classifies an AbortController timeout", async () => {
		const result = await loadSubscriptionContent(URL, {
			timeoutMs: 5,
			fetchImpl: ((_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("aborted", "AbortError"));
					});
				})) as SubscriptionFetchImpl,
		});

		expect(result.content).toBe("");
		expect(result.error?.code).toBe("timeout");
		expect(result.warning).toContain("timed out");
	});

	it("classifies a timeout while reading a streamed response", async () => {
		const result = await loadSubscriptionContent(URL, {
			timeoutMs: 5,
			fetchImpl: async (_input, init) =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							init?.signal?.addEventListener("abort", () =>
								controller.error(new DOMException("aborted", "AbortError")),
							);
						},
					}),
				),
		});

		expect(result.error?.code).toBe("timeout");
		expect(result.warning).toContain("while reading");
	});

	it("classifies a streamed network failure separately from invalid UTF-8", async () => {
		const result = await loadSubscriptionContent(URL, {
			fetchImpl: async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.error(new TypeError("connection reset"));
						},
					}),
				),
		});

		expect(result.error?.code).toBe("network-or-cors");
		expect(result.warning).toContain("network");
	});

	it("treats a successful empty body as an empty subscription", async () => {
		const result = await loadSubscriptionContent(URL, {
			fetchImpl: async () => new Response(null),
		});

		expect(result.error?.code).toBe("empty-subscription");
	});

	it("stops reading an oversized streamed response", async () => {
		const result = await loadSubscriptionContent(URL, {
			maxBytes: 4,
			fetchImpl: async () => response("12345"),
		});

		expect(result.content).toBe("");
		expect(result.error?.code).toBe("response-too-large");
		expect(result.warning).toContain("too large");
	});

	it("distinguishes HTTP 4xx and 5xx responses", async () => {
		const client = await loadSubscriptionContent(URL, {
			fetchImpl: async () => response("no", 404),
		});
		const server = await loadSubscriptionContent(URL, {
			fetchImpl: async () => response("no", 503),
		});

		expect(client.error?.code).toBe("http-4xx");
		expect(client.warning).toContain("HTTP 4xx");
		expect(server.error?.code).toBe("http-5xx");
		expect(server.warning).toContain("HTTP 5xx");
	});

	it("decodes a base64 subscription and keeps multiple URI lines", async () => {
		const plain =
			"vless://uuid@example.com:443#one\ntrojan://pass@example.com:443#two";
		const binary = String.fromCharCode(...new TextEncoder().encode(plain));
		const encoded = btoa(binary);
		const result = await loadSubscriptionContent(URL, {
			fetchImpl: async () => response(encoded),
		});

		expect(result.error).toBe(undefined);
		expect(result.content).toBe(plain);
		expect(result.content.split("\n").length).toBe(2);
		expect(decodeBase64Utf8(encoded)).toBe(plain);
	});

	it("reports malformed base64 and empty subscriptions", async () => {
		const malformed = await loadSubscriptionContent(URL, {
			fetchImpl: async () => response("YWJj$"),
		});
		const empty = await loadSubscriptionContent(URL, {
			fetchImpl: async () => response("  \n\t"),
		});

		expect(malformed.error?.code).toBe("malformed-base64");
		expect(malformed.warning).toContain("base64");
		expect(empty.error?.code).toBe("empty-subscription");
		expect(empty.warning).toContain("empty");
	});

	it("classifies browser network and CORS failures without exposing the URL", async () => {
		const result = await loadSubscriptionContent(
			"https://user:secret@subscription.example/list?token=secret",
			{
				fetchImpl: async () => {
					throw new TypeError("Failed to fetch");
				},
			},
		);

		expect(result.error?.code).toBe("network-or-cors");
		expect(result.warning).toContain("CORS");
		expect(result.warning).not.toContain("secret");
	});
});
