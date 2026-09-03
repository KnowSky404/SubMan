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
import {
	type SingBoxTarget,
	supportsUtlsFingerprint,
	supportsVmessSecurity,
} from "./target";
import type { SingBoxOutbound } from "./uri-types";

export function parseVmess(
	raw: string,
	fallbackTag: string,
	target: SingBoxTarget,
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
		if (security && !supportsVmessSecurity(target, security)) {
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

		const globalPadding = booleanValue(
			data.global_padding ?? data.globalPadding,
		);
		if (globalPadding !== null) outbound.global_padding = globalPadding;
		const authenticatedLength = booleanValue(
			data.authenticated_length ?? data.authenticatedLength,
		);
		if (authenticatedLength !== null) {
			outbound.authenticated_length = authenticatedLength;
		}

		const network = stringValue(data.net) ?? stringValue(data.network);
		if (network === "tcp" || network === "udp") outbound.network = network;
		const transportQuery = new URLSearchParams();
		if (network) transportQuery.set("type", network);
		for (const [source, targetKey] of [
			["host", "host"],
			["path", "path"],
			["serviceName", "serviceName"],
		] as const) {
			const value = stringValue(data[source]);
			if (value) transportQuery.set(targetKey, value);
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
		for (const [source, targetKey] of [
			["sni", "sni"],
			["alpn", "alpn"],
			["fp", "fp"],
		] as const) {
			const value = stringValue(data[source]);
			if (value) tlsQuery.set(targetKey, value);
		}
		const fingerprint = tlsQuery.get("fp")?.toLowerCase();
		if (fingerprint && !supportsUtlsFingerprint(target, fingerprint)) {
			return `Invalid vmess URI: unsupported uTLS fingerprint for ${fallbackTag}`;
		}
		const allowInsecure = booleanValue(
			data.allowInsecure ?? data.allow_insecure,
		);
		if (allowInsecure !== null) {
			tlsQuery.set("insecure", allowInsecure ? "1" : "0");
		}
		if (tlsValue === "tls" || tlsQuery.size > 0) {
			outbound.tls = buildTls(tlsQuery);
		}
		if (transport?.type === "quic" && !outbound.tls) {
			return `Invalid vmess URI: QUIC transport requires TLS for ${fallbackTag}`;
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

		const muxValue = data.mux ?? data.multiplex;
		const muxEnabled = booleanValue(muxValue) === true;
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

function booleanValue(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (typeof value === "number" && (value === 0 || value === 1)) {
		return value === 1;
	}
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return null;
}
