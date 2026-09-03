import type { Hysteria2UriIssue, ParsedHysteria2Uri } from "$lib/hysteria2-uri";
import { buildTls, type ProtocolParseResult, queryValue } from "./common";
import type { SingBoxOutbound } from "./uri-types";

export function parseHysteria2(
	parsed: ParsedHysteria2Uri,
	fallbackTag: string,
): ProtocolParseResult {
	const outbound: SingBoxOutbound = {
		type: "hysteria2",
		tag: parsed.tag ?? fallbackTag,
		server: parsed.server,
		password: parsed.password,
		tls: buildTls(parsed.query),
	};
	if (parsed.serverPort !== null) {
		outbound.server_port = parsed.serverPort;
	} else {
		outbound.server_ports = parsed.serverPorts;
	}

	const network = queryValue(parsed.query, "network");
	if (network) {
		if (network !== "tcp" && network !== "udp") {
			return `Invalid Hysteria2 URI: unsupported network for ${fallbackTag}`;
		}
		outbound.network = network;
	}
	if (parsed.obfs) {
		outbound.obfs = {
			type: parsed.obfs.type,
			password: parsed.obfs.password,
		};
	}
	return outbound;
}

export function describeHysteria2UriIssue(
	issue: Hysteria2UriIssue,
	fallbackTag: string,
): string {
	switch (issue) {
		case "missing-auth":
			return `Invalid Hysteria2 URI: missing authentication for ${fallbackTag}`;
		case "missing-server":
			return `Invalid Hysteria2 URI: missing server for ${fallbackTag}`;
		case "invalid-port":
			return `Invalid Hysteria2 URI: invalid port specification for ${fallbackTag}`;
		case "unsupported-obfs":
			return `Invalid Hysteria2 URI: unsupported obfs for ${fallbackTag}`;
		case "missing-obfs-password":
			return `Invalid Hysteria2 URI: missing obfs password for ${fallbackTag}`;
		case "unsupported-parameter":
			return `Skipped Hysteria2 URI: unsupported parameter for ${fallbackTag}`;
		case "unsupported-utls-fingerprint":
			return `Skipped Hysteria2 URI: unsupported uTLS fingerprint for ${fallbackTag}`;
		case "unsupported-pin-sha256":
			return `Skipped Hysteria2 URI: certificate pinning is not supported for ${fallbackTag}`;
		case "unsupported-ech":
			return `Skipped Hysteria2 URI: ECH is not supported for ${fallbackTag}`;
		case "malformed-uri":
			return `Invalid Hysteria2 URI: ${fallbackTag}`;
	}
}
