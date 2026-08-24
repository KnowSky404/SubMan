import {
	buildMultiplex,
	buildPacketEncoding,
	buildTls,
	buildTransport,
	decodeBase64Utf8,
	type ProtocolParseResult,
	stringOrNumber,
	stringValue,
} from "./common";
import type { SingBoxOutbound } from "./uri-types";

export function parseVmess(
	raw: string,
	fallbackTag: string,
): ProtocolParseResult {
	const payload = raw.slice(raw.indexOf("://") + 3);
	const decoded = decodeBase64Utf8(payload);
	if (!decoded) return `Invalid vmess URI: ${fallbackTag}`;

	try {
		const data = JSON.parse(decoded) as Record<string, unknown>;
		const server = stringValue(data.add);
		const port = stringOrNumber(data.port);
		const parsedPort = port ? Number(port) : Number.NaN;
		const uuid = stringValue(data.id);
		if (
			!server ||
			!uuid ||
			!Number.isSafeInteger(parsedPort) ||
			parsedPort < 1 ||
			parsedPort > 65535
		) {
			return `Invalid vmess URI: ${fallbackTag}`;
		}

		const security = stringValue(data.scy) ?? stringValue(data.security);
		if (
			security &&
			!["auto", "none", "zero", "aes-128-gcm", "chacha20-poly1305"].includes(
				security,
			)
		) {
			return `Invalid vmess URI: unsupported security for ${fallbackTag}`;
		}

		const outbound: SingBoxOutbound = {
			type: "vmess",
			tag: stringValue(data.ps) ?? fallbackTag,
			server,
			server_port: parsedPort,
			uuid,
		};
		if (security) outbound.security = security;
		const alterId = stringOrNumber(data.aid ?? data.alterId);
		if (alterId) {
			const parsedAlterId = Number(alterId);
			if (Number.isSafeInteger(parsedAlterId) && parsedAlterId >= 0) {
				outbound.alter_id = parsedAlterId;
			}
		}

		const network = stringValue(data.net) ?? stringValue(data.network);
		if (network === "tcp" || network === "udp") outbound.network = network;
		const transportQuery = new URLSearchParams();
		if (network) transportQuery.set("type", network);
		for (const [source, target] of [
			["host", "host"],
			["path", "path"],
			["serviceName", "serviceName"],
		] as const) {
			const value = stringValue(data[source]);
			if (value) transportQuery.set(target, value);
		}
		const transport = buildTransport(transportQuery, network);
		if (typeof transport === "string") {
			return `Invalid vmess URI: ${transport} for ${fallbackTag}`;
		}
		if (transport) outbound.transport = transport;

		const tlsValue = stringValue(data.tls)?.toLowerCase();
		if (tlsValue && !["tls", "none"].includes(tlsValue)) {
			return `Invalid vmess URI: unsupported TLS mode for ${fallbackTag}`;
		}
		const tlsQuery = new URLSearchParams();
		for (const [source, target] of [
			["sni", "sni"],
			["alpn", "alpn"],
			["fp", "fp"],
		] as const) {
			const value = stringValue(data[source]);
			if (value) tlsQuery.set(target, value);
		}
		const allowInsecure = data.allowInsecure ?? data.allow_insecure;
		if (typeof allowInsecure === "boolean") {
			tlsQuery.set("insecure", allowInsecure ? "1" : "0");
		}
		if (tlsValue === "tls" || tlsQuery.size > 0) {
			outbound.tls = buildTls(tlsQuery);
		}

		const packetValue = stringValue(
			data.packetEncoding ?? data.packet_encoding,
		);
		if (packetValue) {
			const packetQuery = new URLSearchParams([
				["packet_encoding", packetValue],
			]);
			const packetEncoding = buildPacketEncoding(packetQuery);
			if (packetEncoding === "invalid") {
				return `Invalid vmess URI: unsupported packet encoding for ${fallbackTag}`;
			}
			if (packetEncoding) outbound.packet_encoding = packetEncoding;
		}

		const muxEnabled = data.mux === true || data.multiplex === true;
		if (muxEnabled) {
			const muxQuery = new URLSearchParams([["mux", "1"]]);
			const concurrency = stringOrNumber(data.muxConcurrency);
			if (concurrency) muxQuery.set("muxConcurrency", concurrency);
			const multiplex = buildMultiplex(muxQuery);
			if (multiplex) outbound.multiplex = multiplex;
		}
		return outbound;
	} catch {
		return `Invalid vmess URI: ${fallbackTag}`;
	}
}
