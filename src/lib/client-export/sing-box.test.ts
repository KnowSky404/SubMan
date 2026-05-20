import { describe, expect, it } from "bun:test";
import type { AggregateRule, NodeItem } from "$lib/models";
import {
	createDefaultSingBoxClientProfile,
	validateSingBoxClientProfile,
} from "./profile";
import { buildSingBoxClientConfig } from "./sing-box";
import { parseProxyUriToSingBoxOutbound } from "./uri";

describe("sing-box client export profile", () => {
	it("creates a default profile for an aggregate rule", () => {
		const profile = createDefaultSingBoxClientProfile(
			"rule-1",
			"2026-05-12T00:00:00.000Z",
		);

		expect(profile.name).toBe("sing-box Client");
		expect(profile.type).toBe("sing-box-client");
		expect(profile.ruleId).toBe("rule-1");
		expect(profile.fileName).toBe("sing-box-client.json");
		expect(profile.options.listenAddress).toBe("127.0.0.1");
		expect(profile.options.listenPort).toBe(2080);
		expect(profile.options.inboundType).toBe("mixed");
		expect(profile.options.routeMode).toBe("global-proxy");
		expect(profile.options.includeExperimental).toBe(true);
	});

	it("blocks invalid listen ports and protected filenames", () => {
		const profile = createDefaultSingBoxClientProfile(
			"rule-1",
			"2026-05-12T00:00:00.000Z",
		);

		expect(
			validateSingBoxClientProfile({ ...profile, fileName: "subman.json" })
				.errors,
		).toContain("Output filename cannot replace subman.json");
		expect(
			validateSingBoxClientProfile({
				...profile,
				options: { ...profile.options, listenPort: 70000 },
			}).errors,
		).toContain("Listen port must be between 1 and 65535");
	});

	it("blocks duplicate selector and URL test tags", () => {
		const profile = createDefaultSingBoxClientProfile(
			"rule-1",
			"2026-05-12T00:00:00.000Z",
		);

		expect(
			validateSingBoxClientProfile({
				...profile,
				options: {
					...profile.options,
					selectorTag: " auto ",
					urlTestTag: "auto",
				},
			}).errors,
		).toContain("Selector tag and URL test tag must be different");
	});

	it("blocks control tags that collide with fixed outbound tags", () => {
		const profile = createDefaultSingBoxClientProfile(
			"rule-1",
			"2026-05-12T00:00:00.000Z",
		);

		expect(
			validateSingBoxClientProfile({
				...profile,
				options: { ...profile.options, selectorTag: "direct" },
			}).errors,
		).toContain("Control tags cannot use direct or block");
		expect(
			validateSingBoxClientProfile({
				...profile,
				options: { ...profile.options, urlTestTag: " block " },
			}).errors,
		).toContain("Control tags cannot use direct or block");
	});
});

describe("sing-box proxy uri parsing", () => {
	it("parses a VLESS reality URI", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"vless://00000000-0000-4000-8000-000000000001@example.com:443?security=reality&sni=www.cloudflare.com&pbk=pubkey&sid=abcd&flow=xtls-rprx-vision#HK%20VLESS",
			"HK VLESS",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "vless",
			tag: "HK VLESS",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000001",
			flow: "xtls-rprx-vision",
			tls: {
				enabled: true,
				server_name: "www.cloudflare.com",
				reality: {
					enabled: true,
					public_key: "pubkey",
					short_id: "abcd",
				},
			},
		});
	});

	it("parses a Trojan URI", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"trojan://password@example.com:443?sni=trojan.example.com#Trojan",
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "trojan",
			tag: "Trojan",
			server: "example.com",
			server_port: 443,
			password: "password",
			tls: {
				enabled: true,
				server_name: "trojan.example.com",
			},
		});
	});

	it("parses a Shadowsocks URI", () => {
		const credentials = btoa("2022-blake3-aes-128-gcm:password");
		const result = parseProxyUriToSingBoxOutbound(
			`ss://${credentials}@example.com:8388#SS`,
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "shadowsocks",
			tag: "SS",
			server: "example.com",
			server_port: 8388,
			method: "2022-blake3-aes-128-gcm",
			password: "password",
		});
	});

	it("parses a Shadowsocks URI with direct username and password", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"ss://aes-128-gcm:password@example.com:8388#SS%20Direct",
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "shadowsocks",
			tag: "SS Direct",
			server: "example.com",
			server_port: 8388,
			method: "aes-128-gcm",
			password: "password",
		});
	});

	it("parses VMess base64 JSON with UTF-8 values", () => {
		const payload = {
			add: "example.com",
			port: "443",
			id: "00000000-0000-4000-8000-000000000002",
			scy: "auto",
			tls: "tls",
			sni: "测试.example.com",
			ps: "香港 VMess",
		};
		const encoded = btoa(
			String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))),
		);
		const result = parseProxyUriToSingBoxOutbound(
			`vmess://${encoded}`,
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "vmess",
			tag: "香港 VMess",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000002",
			security: "auto",
			tls: {
				enabled: true,
				server_name: "测试.example.com",
			},
		});
	});

	it("parses a Hysteria2 URI", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"hysteria2://password@example.com:443?sni=hy2.example.com&obfs=salamander&obfs-password=obfs-pass#HY2",
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "hysteria2",
			tag: "HY2",
			server: "example.com",
			server_port: 443,
			password: "password",
			tls: {
				enabled: true,
				server_name: "hy2.example.com",
			},
			obfs: {
				type: "salamander",
				password: "obfs-pass",
			},
		});
	});

	it("returns a warning for unsupported protocols", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"tuic://token@example.com:443#TUIC",
			"TUIC",
		);

		expect(result.outbound).toBeNull();
		expect(result.warning).toContain("Unsupported protocol");
	});

	it("returns warnings for missing URL credentials", () => {
		const cases = [
			{
				raw: "vless://example.com:443",
				warning: "Invalid VLESS URI",
			},
			{
				raw: "trojan://example.com:443",
				warning: "Invalid Trojan URI",
			},
			{
				raw: "hysteria2://example.com:443",
				warning: "Invalid Hysteria2 URI",
			},
		];

		for (const testCase of cases) {
			const result = parseProxyUriToSingBoxOutbound(
				testCase.raw,
				"Missing Credentials",
			);

			expect(result.outbound).toBeNull();
			expect(result.warning).toContain(testCase.warning);
		}
	});

	it("returns a warning when VLESS reality is missing a public key", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"vless://00000000-0000-4000-8000-000000000001@example.com:443?security=reality&sni=www.cloudflare.com#No%20PBK",
			"No PBK",
		);

		expect(result.outbound).toBeNull();
		expect(result.warning).toContain("public key");
	});
});

describe("sing-box client config export", () => {
	const updatedAt = "2026-05-12T00:00:00.000Z";
	const rule: AggregateRule = {
		id: "rule-1",
		name: "Export Rule",
		nodeIds: ["node-1", "node-2"],
		subscriptionIds: [],
		excludeTagIds: [],
		renameMap: {},
		allowedTypes: [],
		prependRegionFlags: false,
		updatedAt,
	};
	const nodes: NodeItem[] = [
		{
			id: "node-1",
			name: "HK VLESS",
			type: "vless",
			raw: "vless://00000000-0000-4000-8000-000000000001@example.com:443?security=tls&sni=example.com#HK%20VLESS",
			tags: [],
			enabled: true,
			updatedAt,
			source: "single",
		},
		{
			id: "node-2",
			name: "TUIC",
			type: "tuic",
			raw: "tuic://token@example.com:443#TUIC",
			tags: [],
			enabled: true,
			updatedAt,
			source: "single",
		},
	];

	it("builds a runnable config from supported aggregate lines", async () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", updatedAt);
		const result = await buildSingBoxClientConfig(profile, rule, nodes, []);

		expect(result.errors).toEqual([]);
		expect(result.totalLines).toBe(2);
		expect(result.outbounds).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.warnings[0]).toContain("Unsupported protocol");

		const config = result.config as {
			inbounds: Array<Record<string, unknown>>;
			outbounds: Array<Record<string, unknown>>;
			route: { final: string };
		};
		expect(config.inbounds[0].type).toBe("mixed");
		expect(config.inbounds[0].listen).toBe("127.0.0.1");
		expect(config.inbounds[0].listen_port).toBe(2080);
		expect(config.outbounds[0].type).toBe("selector");
		expect(config.outbounds[0].tag).toBe("proxy");
		expect(config.outbounds[0].outbounds).toEqual([
			"auto",
			"HK VLESS",
			"direct",
			"block",
		]);
		expect(config.outbounds.some((outbound) => outbound.type === "dns")).toBe(
			false,
		);
		expect(
			config.outbounds.some((outbound) => outbound.tag === "dns-out"),
		).toBe(false);
		expect(config.outbounds[1].type).toBe("urltest");
		expect(config.outbounds[1].tag).toBe("auto");
		expect(config.outbounds[1].outbounds).toEqual(["HK VLESS"]);
		expect(config.route.final).toBe("proxy");
		expect(JSON.parse(result.content)).toEqual(config);
	});

	it("returns a blocking error when every aggregate line is unsupported", async () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", updatedAt);
		const unsupportedOnlyRule: AggregateRule = {
			...rule,
			nodeIds: ["node-2"],
		};
		const result = await buildSingBoxClientConfig(
			profile,
			unsupportedOnlyRule,
			nodes,
			[],
		);

		expect(result.errors).toEqual(["No supported outbounds can be generated"]);
		expect(result.content).toBe("");
	});

	it("suffixes remote tags that collide with literal selector and urltest tags", async () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", updatedAt);
		const collisionRule: AggregateRule = {
			...rule,
			nodeIds: ["selector-node", "urltest-node"],
		};
		const collisionNodes: NodeItem[] = [
			{
				id: "selector-node",
				name: "selector",
				type: "vless",
				raw: "vless://00000000-0000-4000-8000-000000000001@example.com:443?security=tls&sni=example.com#selector",
				tags: [],
				enabled: true,
				updatedAt,
				source: "single",
			},
			{
				id: "urltest-node",
				name: "urltest",
				type: "vless",
				raw: "vless://00000000-0000-4000-8000-000000000002@example.net:443?security=tls&sni=example.net#urltest",
				tags: [],
				enabled: true,
				updatedAt,
				source: "single",
			},
		];
		const result = await buildSingBoxClientConfig(
			profile,
			collisionRule,
			collisionNodes,
			[],
		);

		const config = result.config as {
			outbounds: Array<Record<string, unknown>>;
		};
		const remoteTags = config.outbounds
			.filter((outbound) => outbound.type === "vless")
			.map((outbound) => outbound.tag);

		expect(remoteTags).toEqual(["selector 2", "urltest 2"]);
		expect(remoteTags).not.toContain("selector");
		expect(remoteTags).not.toContain("urltest");
	});
});
