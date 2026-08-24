import { describe, expect, it } from "bun:test";
import {
	inferProxyTypeFromRaw,
	PROXY_TYPES,
	validateProxyUri,
} from "./proxy-protocol";

describe("shared proxy URI validation", () => {
	it("keeps one canonical model protocol list", () => {
		expect(PROXY_TYPES).toEqual([
			"vless",
			"vmess",
			"trojan",
			"ss",
			"ssr",
			"hysteria2",
			"tuic",
			"anytls",
			"other",
		]);
		expect(inferProxyTypeFromRaw("hy2://password@example.com:443")).toBe(
			"hysteria2",
		);
	});

	it("reports a declared type and URI scheme conflict without throwing", () => {
		const result = validateProxyUri(
			"vless://00000000-0000-4000-8000-000000000001@example.com:443",
			"trojan",
		);

		expect(result.syntaxValid).toBe(true);
		expect(result.inferredType).toBe("vless");
		expect(result.issues).toContain("declared-type-mismatch");
	});

	it("detects missing core fields and malformed syntax", () => {
		const missing = validateProxyUri("tuic://password@example.com:443", "tuic");
		const malformed = validateProxyUri("vless://%ZZ", "vless");

		expect(missing.syntaxValid).toBe(true);
		expect(missing.coreFieldsValid).toBe(false);
		expect(missing.issues).toContain("missing-uuid");
		expect(malformed.syntaxValid).toBe(false);
		expect(malformed.issues).toContain("malformed-uri");
	});

	it("accepts legacy and unknown nodes for warning-first compatibility", () => {
		const legacy = validateProxyUri("custom://legacy.example:443", "other");
		const unknown = validateProxyUri("not-a-uri", "other");

		expect(legacy.syntaxValid).toBe(true);
		expect(legacy.inferredType).toBe("other");
		expect(legacy.issues).toContain("unsupported-scheme");
		expect(unknown.syntaxValid).toBe(false);
		expect(unknown.inferredType).toBe("other");
	});
});
