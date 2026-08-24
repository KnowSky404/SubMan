import {
	buildMultiplex,
	buildTls,
	buildTransport,
	decodeComponent,
	type ParsedProxyUri,
	type ProtocolParseResult,
} from "./common";
import type { SingBoxOutbound } from "./uri-types";

export function parseTrojan(
	parsed: ParsedProxyUri,
	fallbackTag: string,
): ProtocolParseResult {
	const password = decodeComponent(parsed.url.username);
	if (!password)
		return `Invalid Trojan URI: missing password for ${fallbackTag}`;

	const outbound: SingBoxOutbound = {
		type: "trojan",
		tag: parsed.tag,
		server: parsed.server,
		server_port: parsed.serverPort,
		password,
		tls: buildTls(parsed.query),
	};
	const network = parsed.query.get("network");
	const transport = buildTransport(parsed.query, network);
	if (typeof transport === "string") {
		return `Invalid Trojan URI: ${transport} for ${fallbackTag}`;
	}
	if (transport) outbound.transport = transport;
	const multiplex = buildMultiplex(parsed.query);
	if (multiplex) outbound.multiplex = multiplex;
	return outbound;
}
