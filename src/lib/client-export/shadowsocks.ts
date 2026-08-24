import {
	buildMultiplex,
	decodeBase64Utf8,
	decodeComponent,
	type ParsedProxyUri,
	type ProtocolParseResult,
	parsePort,
	queryBoolean,
	queryValue,
} from "./common";
import type { SingBoxOutbound } from "./uri-types";

function parseCredentials(value: string | null): string | null {
	if (!value) return null;
	const decoded = decodeBase64Utf8(value);
	return decoded ?? value;
}

export function parseShadowsocks(
	raw: string,
	parsed: ParsedProxyUri | null,
	fallbackTag: string,
): ProtocolParseResult {
	let server = parsed?.server ?? "";
	let serverPort = parsed?.serverPort ?? null;
	let username = parsed ? decodeComponent(parsed.url.username) : null;
	let password = parsed ? decodeComponent(parsed.url.password) : null;
	let query = parsed?.query ?? new URLSearchParams();
	let tag = parsed?.tag ?? fallbackTag;

	if (!server || serverPort === null) {
		const rawUrl = new URL(raw);
		query = rawUrl.searchParams;
		const decodedTag = decodeComponent(rawUrl.hash.slice(1));
		if (decodedTag) tag = decodedTag;
		const authority = raw
			.slice(raw.indexOf("://") + 3)
			.split(/[?#]/, 1)[0]
			.trim();
		const decodedAuthority = decodeBase64Utf8(authority);
		if (!decodedAuthority) return `Invalid shadowsocks URI: ${fallbackTag}`;
		try {
			const decodedUrl = new URL(`ss://${decodedAuthority}`);
			server = decodedUrl.hostname;
			serverPort = parsePort(decodedUrl.port);
			username = decodeComponent(decodedUrl.username);
			password = decodeComponent(decodedUrl.password);
		} catch {
			return `Invalid shadowsocks URI: ${fallbackTag}`;
		}
	}

	const credentials = password
		? `${username ?? ""}:${password}`
		: parseCredentials(username);
	const separatorIndex = credentials?.indexOf(":") ?? -1;
	if (
		!server ||
		serverPort === null ||
		!credentials ||
		separatorIndex <= 0 ||
		separatorIndex === credentials.length - 1
	) {
		return `Invalid shadowsocks URI: ${fallbackTag}`;
	}

	const outbound: SingBoxOutbound = {
		type: "shadowsocks",
		tag: tag,
		server,
		server_port: serverPort,
		method: credentials.slice(0, separatorIndex),
		password: credentials.slice(separatorIndex + 1),
	};
	const pluginValue = queryValue(query, "plugin");
	if (pluginValue) {
		const [plugin, ...options] = pluginValue.split(";");
		if (!plugin) return `Invalid shadowsocks URI: plugin for ${fallbackTag}`;
		outbound.plugin = plugin;
		if (options.length > 0) outbound.plugin_opts = options.join(";");
	}
	const pluginOptions = queryValue(query, "plugin_opts", "plugin-options");
	if (pluginOptions) outbound.plugin_opts = pluginOptions;
	const udpOverTcp = queryBoolean(query, "uot", "udp_over_tcp");
	if (udpOverTcp === true) outbound.udp_over_tcp = { enabled: true };
	const multiplex = buildMultiplex(query);
	if (multiplex) outbound.multiplex = multiplex;
	return outbound;
}
