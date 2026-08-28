import { describe, expect, it } from "bun:test";
import { type ParsedHysteria2Uri, parseHysteria2Uri } from "./hysteria2-uri";
import { validateProxyUri } from "./proxy-protocol";

function parse(raw: string): ParsedHysteria2Uri {
	const result = parseHysteria2Uri(raw);
	if (!result.ok)
		throw new Error(`unexpected Hysteria2 issue: ${result.issue}`);
	return result.value;
}

describe("Hysteria2 shared URI parsing", () => {
	it("defaults an omitted port to 443", () => {
		const parsed = parse("hy2://password@example.com#Default");

		expect(parsed.server).toBe("example.com");
		expect(parsed.serverPort).toBe(443);
		expect(parsed.serverPorts).toEqual([]);
		expect(parsed.password).toBe("password");
		expect(parsed.tag).toBe("Default");
	});

	it("preserves userpass authentication after component decoding", () => {
		const parsed = parse(
			"hysteria2://user%3Aname:pass%40word@example.com:8443#Userpass",
		);

		expect(parsed.password).toBe("user:name:pass@word");
		expect(parsed.serverPort).toBe(8443);
	});

	it("converts multi-port and range syntax for sing-box", () => {
		const ports = parse("hy2://password@example.com:443,8443,9443#Ports");
		const range = parse("hy2://password@example.com:5000-6000#Range");
		const mixed = parse("hy2://password@example.com:443,5000-6000,8443#Mixed");

		expect(ports.serverPort).toBeNull();
		expect(ports.serverPorts).toEqual(["443:443", "8443:8443", "9443:9443"]);
		expect(range.serverPort).toBeNull();
		expect(range.serverPorts).toEqual(["5000:6000"]);
		expect(mixed.serverPorts).toEqual(["443:443", "5000:6000", "8443:8443"]);
	});

	it("accepts bracketed IPv6 with port hopping", () => {
		const parsed = parse("hy2://password@[2001:db8::1]:443,5000-6000#IPv6");

		expect(parsed.server).toBe("2001:db8::1");
		expect(parsed.serverPort).toBeNull();
		expect(parsed.serverPorts).toEqual(["443:443", "5000:6000"]);
	});

	it("rejects malformed port specifications deterministically", () => {
		for (const raw of [
			"hy2://password@example.com:0",
			"hy2://password@example.com:65536",
			"hy2://password@example.com:6000-5000",
			"hy2://password@example.com:-6000",
			"hy2://password@example.com:5000-",
			"hy2://password@example.com:443,,8443",
			"hy2://password@example.com:443,",
		]) {
			expect(parseHysteria2Uri(raw)).toEqual({
				ok: false,
				issue: "invalid-port",
			});
		}
	});

	it("fails closed for unsupported security semantics", () => {
		expect(
			parseHysteria2Uri("hy2://password@example.com:443?pinSHA256=deadbeef"),
		).toEqual({ ok: false, issue: "unsupported-pin-sha256" });
		expect(
			parseHysteria2Uri("hy2://password@example.com:443?ech=ZWNoLWNvbmZpZw=="),
		).toEqual({ ok: false, issue: "unsupported-ech" });
	});

	it("requires passwords for supported obfuscation types", () => {
		expect(
			parseHysteria2Uri("hy2://password@example.com:443?obfs=salamander"),
		).toEqual({ ok: false, issue: "missing-obfs-password" });
		expect(
			parseHysteria2Uri(
				"hy2://password@example.com:443?obfs=unknown&obfs-password=secret",
			),
		).toEqual({ ok: false, issue: "unsupported-obfs" });
	});
});

describe("Hysteria2 shared validation", () => {
	it("accepts default and multi-port forms without a missing-port issue", () => {
		for (const raw of [
			"hy2://password@example.com",
			"hysteria2://password@example.com:443,5000-6000",
		]) {
			const result = validateProxyUri(raw, "hysteria2");
			expect(result.syntaxValid).toBe(true);
			expect(result.coreFieldsValid).toBe(true);
			expect(result.issues).not.toContain("missing-port");
		}
	});

	it("keeps malformed ranges core-invalid while preserving scheme inference", () => {
		const result = validateProxyUri(
			"hy2://password@example.com:6000-5000",
			"hysteria2",
		);

		expect(result.inferredType).toBe("hysteria2");
		expect(result.syntaxValid).toBe(true);
		expect(result.coreFieldsValid).toBe(false);
		expect(result.issues).toContain("invalid-port");
	});

	it("surfaces unsupported certificate pinning and ECH", () => {
		const pinned = validateProxyUri(
			"hy2://password@example.com?pinSHA256=deadbeef",
			"hysteria2",
		);
		const ech = validateProxyUri(
			"hy2://password@example.com?ech=ZWNoLWNvbmZpZw==",
			"hysteria2",
		);

		expect(pinned.coreFieldsValid).toBe(false);
		expect(pinned.issues).toContain("unsupported-pin-sha256");
		expect(ech.coreFieldsValid).toBe(false);
		expect(ech.issues).toContain("unsupported-ech");
	});
});
