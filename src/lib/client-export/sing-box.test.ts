import { describe, expect, it } from "bun:test";
import type { AggregateRule, NodeItem } from "$lib/models";
import {
	createDefaultSingBoxClientProfile,
	hasClientExportOutputChanged,
	validateSingBoxClientProfile,
} from "./profile";
import { buildSingBoxClientConfig } from "./sing-box";
import { parseProxyUriToSingBoxOutbound } from "./uri";

declare const Bun: {
	file(path: URL): { text(): Promise<string> };
};

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

	it("does not invalidate published output for metadata-only profile changes", () => {
		const profile = createDefaultSingBoxClientProfile(
			"rule-1",
			"2026-05-12T00:00:00.000Z",
		);

		expect(
			hasClientExportOutputChanged(profile, {
				...profile,
				name: "Renamed profile",
				updatedAt: "2026-05-12T01:00:00.000Z",
			}),
		).toBe(false);
	});

	it("invalidates published output when export-affecting fields change", () => {
		const profile = createDefaultSingBoxClientProfile(
			"rule-1",
			"2026-05-12T00:00:00.000Z",
		);

		expect(
			hasClientExportOutputChanged(profile, {
				...profile,
				fileName: "renamed-client.json",
			}),
		).toBe(true);
		expect(
			hasClientExportOutputChanged(profile, {
				...profile,
				ruleId: "rule-2",
			}),
		).toBe(true);
		expect(
			hasClientExportOutputChanged(profile, {
				...profile,
				options: { ...profile.options, listenPort: 2081 },
			}),
		).toBe(true);
	});
});

describe("sing-box proxy uri parsing", () => {
	it("accepts the checked-in TUIC and AnyTLS fixtures", async () => {
		const tuic = (
			await Bun.file(
				new URL("./fixtures/tuic.valid.txt", import.meta.url),
			).text()
		).trim();
		const anytls = (
			await Bun.file(
				new URL("./fixtures/anytls.valid.txt", import.meta.url),
			).text()
		).trim();
		const invalidTuic = (
			await Bun.file(
				new URL("./fixtures/tuic.invalid.txt", import.meta.url),
			).text()
		).trim();

		expect(
			Boolean(parseProxyUriToSingBoxOutbound(tuic, "fixture").outbound),
		).toBe(true);
		expect(
			Boolean(parseProxyUriToSingBoxOutbound(anytls, "fixture").outbound),
		).toBe(true);
		expect(
			parseProxyUriToSingBoxOutbound(invalidTuic, "fixture").outbound,
		).toBe(null);
	});

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

	it("maps Shadowsocks SIP003 plugin options and base64 authority form", () => {
		const encoded = btoa("aes-128-gcm:password@example.com:8388");
		const result = parseProxyUriToSingBoxOutbound(
			`ss://${encoded}?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dcdn.example.com#SS%20Plugin`,
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "shadowsocks",
			tag: "SS Plugin",
			server: "example.com",
			server_port: 8388,
			method: "aes-128-gcm",
			password: "password",
			plugin: "obfs-local",
			plugin_opts: "obfs=http;obfs-host=cdn.example.com",
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

	it("maps VMess WebSocket transport and packet encoding", () => {
		const payload = {
			add: "example.com",
			port: "443",
			id: "00000000-0000-4000-8000-000000000006",
			net: "ws",
			host: "cdn.example.com",
			path: "/vmess",
			tls: "tls",
			sni: "edge.example.com",
			packetEncoding: "packetaddr",
		};
		const encoded = btoa(JSON.stringify(payload));
		const result = parseProxyUriToSingBoxOutbound(
			`vmess://${encoded}`,
			"VMess",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "vmess",
			tag: "VMess",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000006",
			tls: { enabled: true, server_name: "edge.example.com" },
			transport: {
				type: "ws",
				path: "/vmess",
				headers: { Host: "cdn.example.com" },
			},
			packet_encoding: "packetaddr",
		});
	});

	it("parses a Hysteria2 URI", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"hysteria2://password@example.com:443?network=udp&sni=hy2.example.com&obfs=salamander&obfs-password=obfs-pass#HY2",
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "hysteria2",
			tag: "HY2",
			server: "example.com",
			server_port: 443,
			password: "password",
			network: "udp",
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

	it("maps Hysteria2 TLS ALPN and insecure settings", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"hy2://password@example.com:443?sni=hy2.example.com&alpn=h3&insecure=1#HY2%20TLS",
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "hysteria2",
			tag: "HY2 TLS",
			server: "example.com",
			server_port: 443,
			password: "password",
			tls: {
				enabled: true,
				server_name: "hy2.example.com",
				alpn: ["h3"],
				insecure: true,
			},
		});
	});

	it("parses a TUIC URI with transport and TLS options", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"tuic://00000000-0000-4000-8000-000000000003:tuic-pass@example.com:443?network=tcp&congestion_control=bbr&udp_relay_mode=native&zero_rtt_handshake=1&heartbeat=10s&sni=tuic.example.com&alpn=h3,hq&allow_insecure=1#TUIC",
			"TUIC",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "tuic",
			tag: "TUIC",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000003",
			password: "tuic-pass",
			network: "tcp",
			congestion_control: "bbr",
			udp_relay_mode: "native",
			zero_rtt_handshake: true,
			heartbeat: "10s",
			tls: {
				enabled: true,
				server_name: "tuic.example.com",
				alpn: ["h3", "hq"],
				insecure: true,
			},
		});
	});

	it("parses AnyTLS without generating client metadata", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"anytls://anytls-pass@example.com:443?sni=anytls.example.com&alpn=h2,http/1.1&insecure=1&idle_session_check_interval=30s&idle_session_timeout=45s&min_idle_session=2#AnyTLS",
			"AnyTLS",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "anytls",
			tag: "AnyTLS",
			server: "example.com",
			server_port: 443,
			password: "anytls-pass",
			idle_session_check_interval: "30s",
			idle_session_timeout: "45s",
			min_idle_session: 2,
			tls: {
				enabled: true,
				server_name: "anytls.example.com",
				alpn: ["h2", "http/1.1"],
				insecure: true,
			},
		});
		expect(JSON.stringify(result.outbound)).not.toContain("client_metadata");
	});

	it("skips ShadowsocksR with a stable warning", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"ssr://ignored@example.com:443#SSR",
			"SSR",
		);

		expect(result.outbound).toBeNull();
		expect(result.warning).toBe("Skipped ShadowsocksR outbound: SSR");
	});

	it("maps VLESS WebSocket and gRPC transports", () => {
		const websocket = parseProxyUriToSingBoxOutbound(
			"vless://00000000-0000-4000-8000-000000000004@example.com:443?security=tls&sni=edge.example.com&type=ws&host=cdn.example.com&path=%2Fproxy&alpn=h2,http%2F1.1&allowInsecure=1#WS",
			"WS",
		);
		const grpc = parseProxyUriToSingBoxOutbound(
			"vless://00000000-0000-4000-8000-000000000005@example.com:443?security=tls&type=grpc&serviceName=proxy&mode=gun#GRPC",
			"GRPC",
		);

		expect(websocket.warning).toBeNull();
		expect(websocket.outbound).toEqual({
			type: "vless",
			tag: "WS",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000004",
			tls: {
				enabled: true,
				server_name: "edge.example.com",
				alpn: ["h2", "http/1.1"],
				insecure: true,
			},
			transport: {
				type: "ws",
				path: "/proxy",
				headers: { Host: "cdn.example.com" },
			},
		});
		expect(grpc.warning).toBeNull();
		expect(grpc.outbound).toEqual({
			type: "vless",
			tag: "GRPC",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000005",
			tls: { enabled: true },
			transport: { type: "grpc", service_name: "proxy" },
		});
	});

	it("maps VLESS HTTP and HTTPUpgrade transports with network and multiplexing", () => {
		const http = parseProxyUriToSingBoxOutbound(
			"vless://00000000-0000-4000-8000-000000000007@example.com:443?security=tls&network=tcp&type=http&host=cdn.example.com&path=%2Fproxy&mux=1&muxConcurrency=4#HTTP",
			"HTTP",
		);
		const httpUpgrade = parseProxyUriToSingBoxOutbound(
			"vless://00000000-0000-4000-8000-000000000008@example.com:443?security=tls&type=httpupgrade&host=edge.example.com&path=%2Fupgrade#HTTPUpgrade",
			"HTTPUpgrade",
		);

		expect(http.warning).toBeNull();
		expect(http.outbound).toEqual({
			type: "vless",
			tag: "HTTP",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000007",
			network: "tcp",
			tls: { enabled: true },
			transport: {
				type: "http",
				host: ["cdn.example.com"],
				path: "/proxy",
			},
			multiplex: { enabled: true, max_connections: 4 },
		});
		expect(httpUpgrade.warning).toBeNull();
		expect(httpUpgrade.outbound).toEqual({
			type: "vless",
			tag: "HTTPUpgrade",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000008",
			tls: { enabled: true },
			transport: {
				type: "httpupgrade",
				host: "edge.example.com",
				path: "/upgrade",
			},
		});
	});

	it("accepts common string VMess mux and TLS verification flags", () => {
		const payload = {
			add: "example.com",
			port: "443",
			id: "00000000-0000-4000-8000-000000000009",
			net: "grpc",
			serviceName: "proxy",
			tls: "tls",
			allowInsecure: "1",
			mux: "1",
			muxConcurrency: "4",
		};
		const encoded = btoa(JSON.stringify(payload));
		const result = parseProxyUriToSingBoxOutbound(
			`vmess://${encoded}`,
			"VMess mux",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "vmess",
			tag: "VMess mux",
			server: "example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000009",
			transport: { type: "grpc", service_name: "proxy" },
			tls: { enabled: true, insecure: true },
			multiplex: { enabled: true, max_connections: 4 },
		});
	});

	it("rejects malformed percent and base64 encodings", () => {
		const malformedPercent = parseProxyUriToSingBoxOutbound(
			"trojan://bad%ZZ@example.com:443#bad",
			"bad-percent",
		);
		const malformedBase64 = parseProxyUriToSingBoxOutbound(
			"vmess://%%%",
			"bad-base64",
		);

		expect(malformedPercent.outbound).toBeNull();
		expect(malformedPercent.warning).toContain("Invalid Trojan URI");
		expect(malformedBase64.outbound).toBeNull();
		expect(malformedBase64.warning).toContain("Invalid vmess URI");
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
			raw: "tuic://00000000-0000-4000-8000-000000000003:tuic-pass@example.com:443#TUIC",
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
		expect(result.outbounds).toBe(2);
		expect(result.skipped).toBe(0);
		expect(result.warnings).toEqual([]);

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
			"TUIC",
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
		expect(config.outbounds[1].outbounds).toEqual(["HK VLESS", "TUIC"]);
		expect(config.route.final).toBe("proxy");
		expect(JSON.parse(result.content)).toEqual(config);
	});

	it("skips SSR while keeping supported aggregate entries", async () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", updatedAt);
		const ssrRule: AggregateRule = { ...rule, nodeIds: ["node-1", "ssr-node"] };
		const result = await buildSingBoxClientConfig(
			profile,
			ssrRule,
			[
				...nodes,
				{
					id: "ssr-node",
					name: "SSR",
					type: "ssr",
					raw: "ssr://ignored@example.com:443#SSR",
					tags: [],
					enabled: true,
					updatedAt,
					source: "single",
				},
			],
			[],
		);

		expect(result.errors).toEqual([]);
		expect(result.outbounds).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.warnings).toEqual(["Skipped ShadowsocksR outbound: SSR"]);
	});

	it("returns a blocking error when every aggregate line is unsupported", async () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", updatedAt);
		const unsupportedOnlyRule: AggregateRule = {
			...rule,
			nodeIds: ["node-2"],
		};
		const unsupportedNodes = nodes.map((node) =>
			node.id === "node-2"
				? {
						...node,
						type: "ssr" as const,
						raw: "ssr://ignored@example.com:443#SSR",
					}
				: node,
		);
		const result = await buildSingBoxClientConfig(
			profile,
			unsupportedOnlyRule,
			unsupportedNodes,
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
