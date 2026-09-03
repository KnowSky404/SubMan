import { parseHysteria2Uri } from "$lib/hysteria2-uri";
import { detectProxyScheme } from "$lib/proxy-protocol";
import { parseAnyTls } from "./anytls";
import {
	hasUnsupportedUtlsFingerprint,
	type ProtocolParseResult,
	parseProxyUrl,
} from "./common";
import { describeHysteria2UriIssue, parseHysteria2 } from "./hysteria2";
import { parseShadowsocks } from "./shadowsocks";
import {
	DEFAULT_SING_BOX_TARGET_VERSION,
	getSingBoxTarget,
	type SingBoxTargetVersion,
} from "./target";
import { parseTrojan } from "./trojan";
import { parseTuic } from "./tuic";
import type { SingBoxOutbound } from "./uri-types";
import { parseVless } from "./vless";
import { parseVmess } from "./vmess";

export type { SingBoxOutbound } from "./uri-types";

export type UriParseResult = {
	outbound: SingBoxOutbound | null;
	warning: string | null;
};

export const SING_BOX_EXPORT_PROTOCOLS = [
	"vless",
	"vmess",
	"trojan",
	"ss",
	"hysteria2",
	"hy2",
	"tuic",
	"anytls",
] as const;

export function parseProxyUriToSingBoxOutbound(
	raw: string,
	fallbackTag: string,
	targetVersion: SingBoxTargetVersion = DEFAULT_SING_BOX_TARGET_VERSION,
): UriParseResult {
	const normalized = raw.trim();
	const protocol = detectProxyScheme(normalized) ?? "";
	const target = getSingBoxTarget(targetVersion);
	if (!protocol) return warning(`Invalid proxy URI: ${fallbackTag}`);
	if (protocol === "ssr") {
		return warning(`Skipped ShadowsocksR outbound: ${fallbackTag}`);
	}

	if (protocol === "vmess") {
		return finish(parseVmess(normalized, fallbackTag, target));
	}
	if (protocol === "hysteria2" || protocol === "hy2") {
		const parsedHysteria2 = parseHysteria2Uri(normalized, target);
		if (!parsedHysteria2.ok) {
			return warning(
				describeHysteria2UriIssue(parsedHysteria2.issue, fallbackTag),
			);
		}
		return finish(parseHysteria2(parsedHysteria2.value, fallbackTag));
	}

	const parsed = parseProxyUrl(normalized, fallbackTag, protocol);
	if (typeof parsed === "string") {
		if (protocol === "ss") {
			return finish(parseShadowsocks(normalized, null, fallbackTag, target));
		}
		return warning(parsed);
	}
	if (
		["vless", "trojan", "tuic", "anytls"].includes(protocol) &&
		hasUnsupportedUtlsFingerprint(parsed.query, target)
	) {
		return warning(
			`Invalid ${protocol} URI: unsupported uTLS fingerprint for ${fallbackTag}`,
		);
	}

	let result: ProtocolParseResult;
	switch (protocol) {
		case "vless":
			result = parseVless(parsed, fallbackTag);
			break;
		case "trojan":
			result = parseTrojan(parsed, fallbackTag);
			break;
		case "ss":
			result = parseShadowsocks(normalized, parsed, fallbackTag, target);
			break;
		case "tuic":
			result = parseTuic(parsed, fallbackTag);
			break;
		case "anytls":
			result = parseAnyTls(parsed, fallbackTag);
			break;
		default:
			return warning(`Unsupported protocol ${protocol}: ${fallbackTag}`);
	}
	return finish(result);
}

function finish(result: ProtocolParseResult): UriParseResult {
	return typeof result === "string"
		? warning(result)
		: { outbound: result, warning: null };
}

function warning(message: string): UriParseResult {
	return { outbound: null, warning: message };
}
