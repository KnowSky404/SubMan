import {
	buildTls,
	decodeComponent,
	type ParsedProxyUri,
	type ProtocolParseResult,
	queryValue,
} from "./common";
import type { SingBoxOutbound } from "./uri-types";

export function parseHysteria2(
	parsed: ParsedProxyUri,
	fallbackTag: string,
): ProtocolParseResult {
	const username = decodeComponent(parsed.url.username);
	const passwordPart = decodeComponent(parsed.url.password);
	const password = passwordPart || username;
	if (!password) {
		return `Invalid Hysteria2 URI: missing password for ${fallbackTag}`;
	}

	const obfs = queryValue(parsed.query, "obfs");
	if (obfs && obfs !== "salamander") {
		return `Invalid Hysteria2 URI: unsupported obfs for ${fallbackTag}`;
	}
	const outbound: SingBoxOutbound = {
		type: "hysteria2",
		tag: parsed.tag,
		server: parsed.server,
		server_port: parsed.serverPort,
		password,
		tls: buildTls(parsed.query),
	};
	const network = queryValue(parsed.query, "network");
	if (network) {
		if (network !== "tcp" && network !== "udp") {
			return `Invalid Hysteria2 URI: unsupported network for ${fallbackTag}`;
		}
		outbound.network = network;
	}
	const obfsPassword = queryValue(
		parsed.query,
		"obfs-password",
		"obfs_password",
	);
	if (obfs) {
		outbound.obfs = {
			type: obfs,
			...(obfsPassword ? { password: obfsPassword } : {}),
		};
	}
	return outbound;
}
