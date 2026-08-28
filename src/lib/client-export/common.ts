import type { SingBoxOutbound } from "./uri-types";

export type ParsedProxyUri = {
	url: URL;
	server: string;
	serverPort: number;
	tag: string;
	query: URLSearchParams;
};

export type ProtocolParseResult = SingBoxOutbound | string;

export function parseProxyUrl(
	raw: string,
	fallbackTag: string,
	protocol: string,
): ParsedProxyUri | string {
	try {
		const url = new URL(raw);
		const tag = decodeComponent(url.hash.slice(1));
		const server = url.hostname;
		const serverPort = parsePort(url.port);
		if (!server || serverPort === null || tag === null) {
			return `Invalid ${protocol} URI: ${fallbackTag}`;
		}

		return {
			url,
			server,
			serverPort,
			tag: tag || fallbackTag,
			query: url.searchParams,
		};
	} catch {
		return `Invalid ${protocol} URI: ${fallbackTag}`;
	}
}

export function decodeComponent(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

export function parsePort(value: string): number | null {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		return null;
	}
	return parsed;
}

export function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function stringOrNumber(value: unknown): string | null {
	if (typeof value === "string" && value.length > 0) return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return null;
}

export function queryValue(
	query: URLSearchParams,
	...names: string[]
): string | null {
	for (const name of names) {
		const value = query.get(name);
		if (value?.trim()) return value.trim();
	}
	return null;
}

export function queryBoolean(
	query: URLSearchParams,
	...names: string[]
): boolean | null {
	const value = queryValue(query, ...names)?.toLowerCase();
	if (!value) return null;
	if (["1", "true", "yes", "on"].includes(value)) return true;
	if (["0", "false", "no", "off"].includes(value)) return false;
	return null;
}

export function queryList(
	query: URLSearchParams,
	...names: string[]
): string[] {
	const value = queryValue(query, ...names);
	return value
		? value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean)
		: [];
}

export function decodeBase64Utf8(value: string): string | null {
	const compact = value.trim().replace(/\s+/g, "");
	if (!compact || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null;
	if (compact.includes("=") && !/=+$/.test(compact)) return null;

	const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
	if (normalized.length % 4 === 1) return null;
	const padded = normalized.padEnd(
		normalized.length + ((4 - (normalized.length % 4)) % 4),
		"=",
	);

	try {
		const binary = atob(padded);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

export function buildTls(
	query: URLSearchParams,
	options: { enabled?: boolean; reality?: boolean } = {},
): Record<string, unknown> {
	const tls: Record<string, unknown> = {
		enabled: options.enabled ?? true,
	};
	const serverName = queryValue(query, "sni", "serverName", "server_name");
	const alpn = queryList(query, "alpn");
	const insecure = queryBoolean(
		query,
		"allowInsecure",
		"allow_insecure",
		"insecure",
		"skip-cert-verify",
	);
	const fingerprint = queryValue(query, "fp", "fingerprint");
	if (serverName) tls.server_name = serverName;
	if (alpn.length > 0) tls.alpn = alpn;
	if (insecure !== null) tls.insecure = insecure;
	if (fingerprint) tls.utls = { enabled: true, fingerprint };

	if (options.reality) {
		const publicKey = queryValue(query, "pbk", "public_key");
		const shortId = queryValue(query, "sid", "short_id") ?? "";
		tls.reality = {
			enabled: true,
			public_key: publicKey ?? "",
			short_id: shortId,
		};
	}

	return tls;
}

export function buildTransport(
	query: URLSearchParams,
	transportHint?: string | null,
): Record<string, unknown> | null | string {
	const type = (
		queryValue(query, "type", "network") ??
		transportHint ??
		""
	).toLowerCase();
	if (!type || type === "tcp" || type === "udp" || type === "none") {
		return null;
	}

	const path = queryValue(query, "path", "path_name") ?? "/";
	const host = queryValue(query, "host", "ws-host", "http-host");
	if (type === "ws" || type === "websocket") {
		return {
			type: "ws",
			path,
			...(host ? { headers: { Host: host } } : {}),
		};
	}
	if (type === "grpc") {
		const serviceName = queryValue(
			query,
			"serviceName",
			"service_name",
			"grpc-service-name",
			"path",
		);
		return {
			type: "grpc",
			...(serviceName ? { service_name: serviceName } : {}),
		};
	}
	if (type === "http" || type === "h2") {
		return {
			type: "http",
			...(host ? { host: [host] } : {}),
			path,
		};
	}
	if (type === "httpupgrade" || type === "http-upgrade") {
		return {
			type: "httpupgrade",
			...(host ? { host } : {}),
			path,
		};
	}

	return `Unsupported transport ${type}`;
}

export function buildMultiplex(
	query: URLSearchParams,
): Record<string, unknown> | null {
	const enabled = queryBoolean(query, "mux", "multiplex");
	if (enabled !== true) return null;
	const result: Record<string, unknown> = { enabled: true };
	const maxConnections = queryValue(
		query,
		"muxConcurrency",
		"mux_concurrency",
		"max_connections",
	);
	if (maxConnections) {
		const parsed = Number(maxConnections);
		if (Number.isSafeInteger(parsed) && parsed > 0) {
			result.max_connections = parsed;
		}
	}
	return result;
}

export function buildPacketEncoding(
	query: URLSearchParams,
): "packetaddr" | "xudp" | null | "invalid" {
	const value = queryValue(query, "packetEncoding", "packet_encoding");
	if (!value) return null;
	const normalized = value.toLowerCase();
	if (normalized === "none") return null;
	if (normalized === "packetaddr" || normalized === "xudp") {
		return normalized;
	}
	return "invalid";
}
