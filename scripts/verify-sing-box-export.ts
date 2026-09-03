import { createDefaultSingBoxClientProfile } from "../src/lib/client-export/profile";
import { buildSingBoxClientConfig } from "../src/lib/client-export/sing-box";
import { getSingBoxTarget } from "../src/lib/client-export/target";
import type {
	AggregateRule,
	NodeItem,
	ProxyType,
	SubscriptionItem,
} from "../src/lib/models";

const UPDATED_AT = "2026-09-03T00:00:00.000Z";
const FIXTURE_URL = "https://fixtures.invalid/sing-box-1.14";
const REALITY_PUBLIC_KEY = "N3nQ46KUPaJbXOSPAiV-mO2Zr1nfuavemAGMpzowvDI";

function vmessUri(payload: Record<string, unknown>): string {
	const json = JSON.stringify(payload);
	const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
	return `vmess://${encoded}`;
}

function shadowsocksUri(): string {
	return `ss://${btoa("aes-128-gcm:fixture-password")}@example.com:8388?network=udp&plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dcdn.example.com#Shadowsocks`;
}

function node(id: string, type: ProxyType, raw: string): NodeItem {
	return {
		id,
		name: id,
		type,
		raw,
		tags: [],
		enabled: true,
		updatedAt: UPDATED_AT,
		source: "single",
	};
}

const directNodes = [
	node(
		"vless-reality",
		"vless",
		`vless://00000000-0000-4000-8000-000000000001@example.com:443?security=reality&sni=reality.example.com&pbk=${REALITY_PUBLIC_KEY}&sid=0123456789abcdef&flow=xtls-rprx-vision&fp=chrome#VLESS%20Reality`,
	),
];

const subscriptionUris = [
	"vless://00000000-0000-4000-8000-000000000002@example.com:443?security=tls&sni=ws.example.com&type=ws&host=ws.example.com&path=%2Fsocket#VLESS%20WebSocket",
	"vless://00000000-0000-4000-8000-000000000003@example.com:443?security=tls&sni=grpc.example.com&type=grpc&serviceName=fixture-service#VLESS%20gRPC",
	vmessUri({
		v: "2",
		ps: "VMess WebSocket",
		add: "example.com",
		port: "443",
		id: "00000000-0000-4000-8000-000000000004",
		scy: "aes-128-cfb",
		aid: "0",
		net: "ws",
		host: "vmess.example.com",
		path: "/vmess",
		tls: "tls",
		sni: "vmess.example.com",
		fp: "chrome",
		globalPadding: true,
		authenticatedLength: true,
	}),
	vmessUri({
		v: "2",
		ps: "VMess QUIC",
		add: "example.com",
		port: "443",
		id: "00000000-0000-4000-8000-000000000007",
		scy: "auto",
		aid: "0",
		net: "quic",
		tls: "tls",
		sni: "quic.example.com",
	}),
	"trojan://fixture-password@example.com:443?sni=trojan.example.com&type=grpc&serviceName=trojan-service#Trojan",
	shadowsocksUri(),
	"hy2://fixture-password@example.com#Hysteria2%20Default",
	"hy2://fixture-password@example.com:8443?sni=hy2.example.com&alpn=h3&insecure=1&fp=firefox#Hysteria2%20TLS",
	"hy2://fixture-password@example.com:443,8443#Hysteria2%20Ports",
	"hy2://fixture-password@example.com:5000-6000?obfs=salamander&obfs-password=fixture-obfs#Hysteria2%20Salamander",
	"hy2://fixture-password@[2001:db8::1]:443,5000-6000?obfs=gecko&obfs-password=fixture-gecko#Hysteria2%20Gecko%20IPv6",
	"tuic://00000000-0000-4000-8000-000000000005:fixture-password@example.com:443?congestion_control=bbr&udp_relay_mode=quic&zero_rtt=1&sni=tuic.example.com&alpn=h3#TUIC%20Relay",
	"tuic://00000000-0000-4000-8000-000000000006:fixture-password@example.com:443?congestion_control=cubic&udp_over_stream=1&sni=tuic-stream.example.com&alpn=h3#TUIC%20Stream",
	"anytls://fixture-password@example.com:443?sni=anytls.example.com&alpn=h2,http%2F1.1&insecure=1#AnyTLS",
];

const subscription: SubscriptionItem = {
	id: "local-subscription",
	name: "Local validation fixture",
	url: FIXTURE_URL,
	enabled: true,
	tags: [],
	updatedAt: UPDATED_AT,
};

const rule: AggregateRule = {
	id: "sing-box-validation",
	name: "sing-box validation",
	nodeIds: directNodes.map((item) => item.id),
	subscriptionIds: [subscription.id],
	excludeTagIds: [],
	renameMap: {},
	allowedTypes: [],
	prependRegionFlags: false,
	sortMode: "none",
	updatedAt: UPDATED_AT,
};

async function main(): Promise<void> {
	const target = getSingBoxTarget();
	const profile = createDefaultSingBoxClientProfile(rule.id, UPDATED_AT);
	const result = await buildSingBoxClientConfig(
		profile,
		rule,
		directNodes,
		[subscription],
		{
			targetVersion: target.version,
			loadSubscription: async (url) => {
				if (url !== FIXTURE_URL) {
					throw new Error("Unexpected validation subscription URL");
				}
				return { content: subscriptionUris.join("\n") };
			},
		},
	);

	if (result.errors.length > 0 || result.warnings.length > 0) {
		throw new Error(
			`Fixture export failed: ${result.errors.length} errors, ${result.warnings.length} warnings`,
		);
	}
	const expectedOutbounds = directNodes.length + subscriptionUris.length;
	if (result.outbounds !== expectedOutbounds || result.skipped !== 0) {
		throw new Error(
			`Fixture export count mismatch: ${result.outbounds} outbounds, ${result.skipped} skipped`,
		);
	}
	if (result.content.includes("client_metadata")) {
		throw new Error("AnyTLS client_metadata must not be generated");
	}

	const versionProcess = Bun.spawn(
		["docker", "run", "--rm", target.validationImage, "version"],
		{ stdout: "pipe", stderr: "inherit" },
	);
	const versionOutput = await versionProcess.stdout.text();
	if ((await versionProcess.exited) !== 0) {
		throw new Error("Unable to run the pinned sing-box image");
	}
	if (!versionOutput.includes(`sing-box version ${target.binaryVersion}`)) {
		throw new Error("Pinned sing-box image reported an unexpected version");
	}

	const checkProcess = Bun.spawn(
		[
			"docker",
			"run",
			"--rm",
			"-i",
			target.validationImage,
			"check",
			"--disable-color",
			"-c",
			"/dev/stdin",
		],
		{
			stdin: new Blob([result.content]),
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if ((await checkProcess.exited) !== 0) {
		throw new Error("sing-box rejected the generated fixture configuration");
	}

	console.log(
		`Validated ${result.outbounds} generated outbounds with sing-box ${target.binaryVersion}.`,
	);
}

await main();
