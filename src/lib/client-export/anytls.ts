import {
	buildTls,
	decodeComponent,
	type ParsedProxyUri,
	type ProtocolParseResult,
	queryValue,
} from "./common";
import type { SingBoxOutbound } from "./uri-types";

function duration(
	query: URLSearchParams,
	name: string,
): string | null | "invalid" {
	const value = queryValue(query, name);
	if (!value) return null;
	return /^\d+(?:ms|s|m|h)$/.test(value) ? value : "invalid";
}

export function parseAnyTls(
	parsed: ParsedProxyUri,
	fallbackTag: string,
): ProtocolParseResult {
	const username = decodeComponent(parsed.url.username);
	const passwordPart = decodeComponent(parsed.url.password);
	const password = passwordPart || username;
	if (!password)
		return `Invalid AnyTLS URI: missing password for ${fallbackTag}`;

	const outbound: SingBoxOutbound = {
		type: "anytls",
		tag: parsed.tag,
		server: parsed.server,
		server_port: parsed.serverPort,
		password,
		tls: buildTls(parsed.query),
	};
	for (const name of [
		"idle_session_check_interval",
		"idle_session_timeout",
	] as const) {
		const value = duration(parsed.query, name);
		if (value === "invalid") {
			return `Invalid AnyTLS URI: ${name} must be a duration for ${fallbackTag}`;
		}
		if (value) outbound[name] = value;
	}
	const minIdle = queryValue(parsed.query, "min_idle_session");
	if (minIdle) {
		const parsedMinIdle = Number(minIdle);
		if (!Number.isSafeInteger(parsedMinIdle) || parsedMinIdle < 0) {
			return `Invalid AnyTLS URI: min_idle_session for ${fallbackTag}`;
		}
		outbound.min_idle_session = parsedMinIdle;
	}
	return outbound;
}
