import {
	buildMultiplex,
	buildPacketEncoding,
	buildTls,
	buildTransport,
	decodeComponent,
	type ParsedProxyUri,
	type ProtocolParseResult,
	queryValue,
} from "./common";
import type { SingBoxOutbound } from "./uri-types";

export function parseVless(
	parsed: ParsedProxyUri,
	fallbackTag: string,
): ProtocolParseResult {
	const query = parsed.query;
	const uuid = decodeComponent(parsed.url.username);
	if (!uuid) return `Invalid VLESS URI: missing UUID for ${fallbackTag}`;

	const security = (queryValue(query, "security") ?? "none").toLowerCase();
	if (!["none", "tls", "reality"].includes(security)) {
		return `Invalid VLESS URI: unsupported security ${security} for ${fallbackTag}`;
	}
	const encryption = queryValue(query, "encryption");
	if (encryption && encryption.toLowerCase() !== "none") {
		return `Invalid VLESS URI: unsupported encryption for ${fallbackTag}`;
	}
	const flow = queryValue(query, "flow");
	if (flow && flow !== "xtls-rprx-vision") {
		return `Invalid VLESS URI: unsupported flow for ${fallbackTag}`;
	}
	if (security === "reality" && !queryValue(query, "pbk", "public_key")) {
		return `Invalid VLESS reality URI: missing public key for ${fallbackTag}`;
	}
	if (security === "reality" && !queryValue(query, "fp", "fingerprint")) {
		return `Invalid VLESS reality URI: Reality requires uTLS fingerprint for ${fallbackTag}`;
	}

	const outbound: SingBoxOutbound = {
		type: "vless",
		tag: parsed.tag,
		server: parsed.server,
		server_port: parsed.serverPort,
		uuid,
	};
	if (flow) outbound.flow = flow;
	const network = queryValue(query, "network");
	if (network === "tcp" || network === "udp") outbound.network = network;

	const packetEncoding = buildPacketEncoding(query);
	if (packetEncoding === "invalid") {
		return `Invalid VLESS URI: unsupported packet encoding for ${fallbackTag}`;
	}
	if (packetEncoding) outbound.packet_encoding = packetEncoding;

	const transport = buildTransport(query, network);
	if (typeof transport === "string") {
		return `Invalid VLESS URI: ${transport} for ${fallbackTag}`;
	}
	if (transport) outbound.transport = transport;

	const tlsRequired =
		security === "tls" ||
		security === "reality" ||
		Boolean(
			queryValue(
				query,
				"sni",
				"serverName",
				"server_name",
				"alpn",
				"allowInsecure",
				"allow_insecure",
				"insecure",
				"fp",
				"fingerprint",
			),
		);
	if (tlsRequired) {
		outbound.tls = buildTls(query, { reality: security === "reality" });
	}
	if (transport?.type === "quic" && !outbound.tls) {
		return `Invalid VLESS URI: QUIC transport requires TLS for ${fallbackTag}`;
	}

	const multiplex = buildMultiplex(query);
	if (multiplex) outbound.multiplex = multiplex;
	return outbound;
}
