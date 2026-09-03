import {
	buildTls,
	decodeComponent,
	type ParsedProxyUri,
	type ProtocolParseResult,
	queryBoolean,
	queryList,
	queryValue,
} from "./common";
import type { SingBoxOutbound } from "./uri-types";

const CONGESTION_CONTROLS = new Set(["cubic", "new_reno", "bbr"]);
const UDP_RELAY_MODES = new Set(["native", "quic"]);

export function parseTuic(
	parsed: ParsedProxyUri,
	fallbackTag: string,
): ProtocolParseResult {
	const uuid = decodeComponent(parsed.url.username);
	const password = decodeComponent(parsed.url.password);
	if (!uuid || !password) {
		return `Invalid TUIC URI: UUID and password are required for ${fallbackTag}`;
	}

	const outbound: SingBoxOutbound = {
		type: "tuic",
		tag: parsed.tag,
		server: parsed.server,
		server_port: parsed.serverPort,
		uuid,
		password,
		congestion_control: "cubic",
		tls: buildTls(parsed.query),
	};
	const network = queryValue(parsed.query, "network");
	if (network) {
		if (network !== "tcp" && network !== "udp") {
			return `Invalid TUIC URI: unsupported network for ${fallbackTag}`;
		}
		outbound.network = network;
	}
	const congestion = queryValue(parsed.query, "congestion_control");
	if (congestion) {
		if (!CONGESTION_CONTROLS.has(congestion)) {
			return `Invalid TUIC URI: unsupported congestion control for ${fallbackTag}`;
		}
		outbound.congestion_control = congestion;
	}
	const relayMode = queryValue(parsed.query, "udp_relay_mode");
	if (relayMode) {
		if (!UDP_RELAY_MODES.has(relayMode)) {
			return `Invalid TUIC URI: unsupported UDP relay mode for ${fallbackTag}`;
		}
	}
	const udpOverStream = queryBoolean(parsed.query, "udp_over_stream");
	if (udpOverStream === true && relayMode) {
		return `Invalid TUIC URI: conflicting UDP relay settings for ${fallbackTag}`;
	}
	if (udpOverStream !== true) {
		outbound.udp_relay_mode = relayMode ?? "native";
	}
	if (udpOverStream !== null) outbound.udp_over_stream = udpOverStream;
	const zeroRtt = queryBoolean(parsed.query, "zero_rtt_handshake", "zero_rtt");
	if (zeroRtt !== null) outbound.zero_rtt_handshake = zeroRtt;
	const heartbeat = queryValue(parsed.query, "heartbeat");
	if (heartbeat) {
		if (!/^\d+(?:ms|s|m|h)$/.test(heartbeat)) {
			return `Invalid TUIC URI: heartbeat must be a duration for ${fallbackTag}`;
		}
		outbound.heartbeat = heartbeat;
	}
	const alpn = queryList(parsed.query, "alpn");
	if (alpn.length > 0 && typeof outbound.tls === "object" && outbound.tls) {
		(outbound.tls as Record<string, unknown>).alpn = alpn;
	}
	return outbound;
}
