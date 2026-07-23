import { describe, expect, it } from "bun:test";
import { contentSecurityPolicy } from "../security-policy.js";
import { handle } from "./hooks.server";

describe("security response headers", () => {
	it("adds browser security headers without changing the response", async () => {
		const response = await handle({
			event: {} as never,
			resolve: async () => new Response("ok", { status: 202 }),
		});

		expect(response.status).toBe(202);
		expect(await response.text()).toBe("ok");
		expect(response.headers.get("referrer-policy")).toBe(
			"strict-origin-when-cross-origin",
		);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("permissions-policy")).toBe(
			"camera=(), geolocation=(), microphone=(), payment=(), usb=()",
		);
	});

	it("uses SvelteKit nonce CSP with anti-framing", () => {
		expect(contentSecurityPolicy.mode).toBe("nonce");
		expect(contentSecurityPolicy.directives?.["frame-ancestors"]).toEqual([
			"none",
		]);
		expect(contentSecurityPolicy.directives?.["object-src"]).toEqual(["none"]);
		expect(contentSecurityPolicy.directives?.["script-src"]).toEqual(["self"]);
	});
});
