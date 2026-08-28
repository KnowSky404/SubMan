import { describe, expect, it } from "bun:test";
import type { AggregateRule, NodeItem } from "$lib/models";
import { validateProxyUri } from "$lib/proxy-protocol";
import { createDefaultSingBoxClientProfile } from "./profile";
import { buildSingBoxClientConfig } from "./sing-box";
import { parseProxyUriToSingBoxOutbound } from "./uri";

declare const Bun: {
	file(path: URL): { text(): Promise<string> };
};

async function fixtureLines(name: string): Promise<string[]> {
	return (await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text())
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

describe("Hysteria2 sing-box URI fidelity", () => {
	it("keeps shared validation and export parsing aligned for fixtures", async () => {
		for (const raw of await fixtureLines("hysteria2.valid.txt")) {
			const validation = validateProxyUri(raw, "hysteria2");
			const parsed = parseProxyUriToSingBoxOutbound(raw, "fixture");
			expect(validation.syntaxValid).toBe(true);
			expect(validation.coreFieldsValid).toBe(true);
			expect(parsed.warning).toBeNull();
			expect(Boolean(parsed.outbound)).toBe(true);
		}

		for (const raw of await fixtureLines("hysteria2.invalid.txt")) {
			const validation = validateProxyUri(raw, "hysteria2");
			const parsed = parseProxyUriToSingBoxOutbound(raw, "fixture");
			expect(validation.coreFieldsValid).toBe(false);
			expect(parsed.outbound).toBeNull();
			expect(Boolean(parsed.warning)).toBe(true);
		}
	});

	it("uses server_port only for a single or default port", () => {
		const defaultPort = parseProxyUriToSingBoxOutbound(
			"hy2://password@example.com#Default",
			"fallback",
		);
		const singlePort = parseProxyUriToSingBoxOutbound(
			"hy2://password@example.com:8443#Single",
			"fallback",
		);

		expect(defaultPort.outbound).toEqual({
			type: "hysteria2",
			tag: "Default",
			server: "example.com",
			server_port: 443,
			password: "password",
			tls: { enabled: true },
		});
		expect(singlePort.outbound).toEqual({
			type: "hysteria2",
			tag: "Single",
			server: "example.com",
			server_port: 8443,
			password: "password",
			tls: { enabled: true },
		});
		expect("server_ports" in (defaultPort.outbound ?? {})).toBe(false);
		expect("server_ports" in (singlePort.outbound ?? {})).toBe(false);
	});

	it("uses server_ports for lists and ranges without a conflicting port", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"hy2://password@example.com:443,5000-6000,8443#Mixed",
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "hysteria2",
			tag: "Mixed",
			server: "example.com",
			server_ports: ["443:443", "5000:6000", "8443:8443"],
			password: "password",
			tls: { enabled: true },
		});
		expect("server_port" in (result.outbound ?? {})).toBe(false);
	});

	it("preserves userpass and bracketed IPv6", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"hy2://user%3Aname:pass%40word@[2001:db8::1]:443,5000-6000#IPv6",
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "hysteria2",
			tag: "IPv6",
			server: "2001:db8::1",
			server_ports: ["443:443", "5000:6000"],
			password: "user:name:pass@word",
			tls: { enabled: true },
		});
	});

	it("maps Salamander and Gecko without inventing Gecko packet sizes", () => {
		const salamander = parseProxyUriToSingBoxOutbound(
			"hy2://password@example.com:443?obfs=salamander&obfs-password=obfs-pass#Salamander",
			"fallback",
		);
		const gecko = parseProxyUriToSingBoxOutbound(
			"hy2://password@example.com:443?obfs=gecko&obfs-password=gecko-pass#Gecko",
			"fallback",
		);

		expect(salamander.outbound?.obfs).toEqual({
			type: "salamander",
			password: "obfs-pass",
		});
		expect(gecko.outbound?.obfs).toEqual({
			type: "gecko",
			password: "gecko-pass",
		});
		expect(JSON.stringify(gecko.outbound)).not.toContain("min_packet_size");
		expect(JSON.stringify(gecko.outbound)).not.toContain("max_packet_size");
	});

	it("returns stable safe warnings for pinning and ECH", () => {
		const pinned = parseProxyUriToSingBoxOutbound(
			"hy2://blocked-password@example.com:443?pinSHA256=deadbeef#Pinned",
			"Pinned",
		);
		const ech = parseProxyUriToSingBoxOutbound(
			"hy2://blocked-password@example.com:443?ech=ZWNoLXNlY3JldA==#ECH",
			"ECH",
		);

		expect(pinned.warning).toBe(
			"Skipped Hysteria2 URI: certificate pinning is not supported for Pinned",
		);
		expect(ech.warning).toBe(
			"Skipped Hysteria2 URI: ECH is not supported for ECH",
		);
		for (const warning of [pinned.warning ?? "", ech.warning ?? ""]) {
			expect(warning).not.toContain("blocked-password");
			expect(warning).not.toContain("deadbeef");
			expect(warning).not.toContain("ZWNoLXNlY3JldA");
			expect(warning).not.toContain("hy2://");
		}
	});
});

describe("Hysteria2 warning-first client export", () => {
	const updatedAt = "2026-08-28T00:00:00.000Z";
	const rule: AggregateRule = {
		id: "rule-hy2",
		name: "Hysteria2 fidelity",
		nodeIds: ["hy2-valid", "hy2-blocked", "vless-valid"],
		subscriptionIds: [],
		excludeTagIds: [],
		renameMap: {},
		allowedTypes: [],
		prependRegionFlags: false,
		updatedAt,
	};
	const nodes: NodeItem[] = [
		{
			id: "hy2-valid",
			name: "Valid HY2",
			type: "hysteria2",
			raw: "hy2://valid-user:valid-pass@example.com:443,5000-5001?obfs=gecko&obfs-password=valid-gecko#Valid%20HY2",
			tags: [],
			enabled: true,
			updatedAt,
			source: "single",
		},
		{
			id: "hy2-blocked",
			name: "Blocked HY2",
			type: "hysteria2",
			raw: "hy2://blocked-hy2-secret@example.net:443?pinSHA256=blocked-fingerprint#Blocked%20HY2",
			tags: [],
			enabled: true,
			updatedAt,
			source: "single",
		},
		{
			id: "vless-valid",
			name: "Valid VLESS",
			type: "vless",
			raw: "vless://00000000-0000-4000-8000-000000000001@example.org:443?security=tls&sni=example.org#Valid%20VLESS",
			tags: [],
			enabled: true,
			updatedAt,
			source: "single",
		},
	];

	it("skips one unsafe Hysteria2 line while retaining other outbounds", async () => {
		const profile = createDefaultSingBoxClientProfile("rule-hy2", updatedAt);
		const result = await buildSingBoxClientConfig(profile, rule, nodes, []);

		expect(result.errors).toEqual([]);
		expect(result.totalLines).toBe(3);
		expect(result.outbounds).toBe(2);
		expect(result.skipped).toBe(1);
		expect(result.warnings).toEqual([
			"Skipped Hysteria2 URI: certificate pinning is not supported for Blocked HY2",
		]);

		const config = result.config as {
			outbounds: Array<Record<string, unknown>>;
		};
		const hysteria2 = config.outbounds.find(
			(outbound) => outbound.type === "hysteria2",
		);
		expect(hysteria2).toEqual({
			type: "hysteria2",
			tag: "Valid HY2",
			server: "example.com",
			server_ports: ["443:443", "5000:5001"],
			password: "valid-user:valid-pass",
			tls: { enabled: true },
			obfs: { type: "gecko", password: "valid-gecko" },
		});
		expect(
			config.outbounds.some((outbound) => outbound.type === "vless"),
		).toBe(true);

		const warnings = result.warnings.join("\n");
		expect(warnings).not.toContain("blocked-hy2-secret");
		expect(warnings).not.toContain("blocked-fingerprint");
		expect(warnings).not.toContain("hy2://");
		expect(result.content).not.toContain("blocked-hy2-secret");
		expect(result.content).not.toContain("blocked-fingerprint");
		expect(result.content).not.toContain("pinSHA256");
	});
});
