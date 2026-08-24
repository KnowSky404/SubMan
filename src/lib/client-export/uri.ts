import { detectProxyScheme } from "$lib/proxy-protocol";
import { parseAnyTls } from "./anytls";
import { type ProtocolParseResult, parseProxyUrl } from "./common";
import { parseHysteria2 } from "./hysteria2";
import { parseShadowsocks } from "./shadowsocks";
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
): UriParseResult {
	const normalized = raw.trim();
	const protocol = detectProxyScheme(normalized) ?? "";
	if (!protocol) return warning(`Invalid proxy URI: ${fallbackTag}`);
	if (protocol === "ssr") {
		return warning(`Skipped ShadowsocksR outbound: ${fallbackTag}`);
	}

	if (protocol === "vmess") {
		return finish(parseVmess(normalized, fallbackTag));
	}

	const parsed = parseProxyUrl(normalized, fallbackTag, protocol);
	if (typeof parsed === "string") {
		if (protocol === "ss") {
			return finish(parseShadowsocks(normalized, null, fallbackTag));
		}
		return warning(parsed);
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
			result = parseShadowsocks(normalized, parsed, fallbackTag);
			break;
		case "hysteria2":
		case "hy2":
			result = parseHysteria2(parsed, fallbackTag);
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
