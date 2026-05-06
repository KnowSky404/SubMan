import { describe, expect, it } from "bun:test";
import { getBearerToken, isAuthorized } from "./auth";

describe("getBearerToken", () => {
	it("extracts a bearer token from an authorization header", () => {
		expect(getBearerToken("Bearer subman-secret")).toBe("subman-secret");
	});

	it("rejects missing or non-bearer authorization values", () => {
		expect(getBearerToken(null)).toBeNull();
		expect(getBearerToken("Basic abc")).toBeNull();
		expect(getBearerToken("Bearer ")).toBeNull();
	});
});

describe("isAuthorized", () => {
	it("accepts matching bearer tokens", async () => {
		expect(await isAuthorized("Bearer subman-secret", "subman-secret")).toBe(true);
	});

	it("rejects missing configured tokens and mismatched request tokens", async () => {
		expect(await isAuthorized("Bearer subman-secret", "")).toBe(false);
		expect(await isAuthorized("Bearer wrong", "subman-secret")).toBe(false);
		expect(await isAuthorized(null, "subman-secret")).toBe(false);
	});
});
