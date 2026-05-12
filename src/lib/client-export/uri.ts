export type SingBoxOutbound = Record<string, unknown> & { type: string; tag: string };

export type UriParseResult = {
	outbound: SingBoxOutbound | null;
	warning: string | null;
};

type ParsedUrl = {
	url: URL;
	server: string;
	serverPort: number;
	tag: string;
	protocol: string;
};

const SUPPORTED_PROTOCOLS = new Set(["vless", "vmess", "trojan", "ss", "hysteria2", "hy2"]);

export function parseProxyUriToSingBoxOutbound(raw: string, fallbackTag: string): UriParseResult {
	const protocol = raw.split(":", 1)[0]?.toLowerCase() ?? "";

	if (!SUPPORTED_PROTOCOLS.has(protocol)) {
		return warning(`Unsupported protocol ${protocol}: ${fallbackTag}`);
	}

	if (protocol === "vmess") {
		return parseVmess(raw, fallbackTag);
	}

	const parsed = parseUrl(raw, fallbackTag, protocol);
	if (typeof parsed === "string") {
		return warning(parsed);
	}

	if (protocol === "vless") {
		const outbound = parseVless(parsed, fallbackTag);
		return typeof outbound === "string" ? warning(outbound) : ok(outbound);
	}

	if (protocol === "trojan") {
		const outbound = parseTrojan(parsed, fallbackTag);
		return typeof outbound === "string" ? warning(outbound) : ok(outbound);
	}

	if (protocol === "ss") {
		const outbound = parseShadowsocks(parsed, fallbackTag);
		return typeof outbound === "string" ? warning(outbound) : ok(outbound);
	}

	const outbound = parseHysteria2(parsed, fallbackTag);
	return typeof outbound === "string" ? warning(outbound) : ok(outbound);
}

function parseVmess(raw: string, fallbackTag: string): UriParseResult {
	const payload = raw.slice("vmess://".length);
	const decoded = decodeBase64(payload);
	if (!decoded) {
		return warning(`Invalid vmess URI: ${fallbackTag}`);
	}

	try {
		const data = JSON.parse(decoded) as Record<string, unknown>;
		const server = stringValue(data.add);
		const port = parsePort(stringValue(data.port) ?? "");
		const uuid = stringValue(data.id);

		if (!server || port === null || !uuid) {
			return warning(`Invalid vmess URI: ${fallbackTag}`);
		}

		const tag = stringValue(data.ps) ?? fallbackTag;
		const outbound: SingBoxOutbound = {
			type: "vmess",
			tag,
			server,
			server_port: port,
			uuid,
		};
		const security = stringValue(data.scy);
		if (security) {
			outbound.security = security;
		}

		const tls = stringValue(data.tls);
		const serverName = stringValue(data.sni) ?? undefined;
		if (tls === "tls" || serverName) {
			outbound.tls = buildTls(serverName);
		}

		return ok(outbound);
	} catch {
		return warning(`Invalid vmess URI: ${fallbackTag}`);
	}
}

function parseUrl(raw: string, fallbackTag: string, protocol: string): ParsedUrl | string {
	try {
		const url = new URL(raw);
		const server = url.hostname;
		const serverPort = parsePort(url.port);

		if (!server || serverPort === null) {
			return `Invalid ${protocol} URI: ${fallbackTag}`;
		}

		return {
			url,
			server,
			serverPort,
			tag: decodeComponent(url.hash.slice(1)) || fallbackTag,
			protocol,
		};
	} catch {
		return `Invalid ${protocol} URI: ${fallbackTag}`;
	}
}

function parseVless(parsed: ParsedUrl, fallbackTag: string): SingBoxOutbound | string {
	const query = parsed.url.searchParams;
	const security = query.get("security");
	const serverName = query.get("sni") ?? undefined;
	const uuid = decodeComponent(parsed.url.username);

	if (!uuid) {
		return `Invalid VLESS URI: missing UUID for ${fallbackTag}`;
	}

	if (security === "reality" && !getRealityPublicKey(query)) {
		return `Invalid VLESS reality URI: missing public key for ${fallbackTag}`;
	}

	const outbound: SingBoxOutbound = {
		type: "vless",
		tag: parsed.tag,
		server: parsed.server,
		server_port: parsed.serverPort,
		uuid,
	};
	const flow = query.get("flow");
	if (flow) {
		outbound.flow = flow;
	}

	if (security === "tls" || security === "reality" || serverName) {
		outbound.tls = buildTls(serverName, security === "reality", query);
	}

	return outbound;
}

function parseTrojan(parsed: ParsedUrl, fallbackTag: string): SingBoxOutbound | string {
	const serverName = parsed.url.searchParams.get("sni") ?? undefined;
	const password = decodeComponent(parsed.url.username);

	if (!password) {
		return `Invalid Trojan URI: missing password for ${fallbackTag}`;
	}

	const outbound: SingBoxOutbound = {
		type: "trojan",
		tag: parsed.tag,
		server: parsed.server,
		server_port: parsed.serverPort,
		password,
		tls: buildTls(serverName),
	};
	return outbound;
}

function parseShadowsocks(parsed: ParsedUrl, fallbackTag: string): SingBoxOutbound | string {
	const username = decodeComponent(parsed.url.username);
	const password = decodeComponent(parsed.url.password);
	const credentials = password ? `${username}:${password}` : decodeBase64(username);
	const separatorIndex = credentials?.indexOf(":") ?? -1;

	if (!credentials || separatorIndex <= 0) {
		return `Invalid shadowsocks URI: ${fallbackTag}`;
	}

	return {
		type: "shadowsocks",
		tag: parsed.tag,
		server: parsed.server,
		server_port: parsed.serverPort,
		method: credentials.slice(0, separatorIndex),
		password: credentials.slice(separatorIndex + 1),
	};
}

function parseHysteria2(parsed: ParsedUrl, fallbackTag: string): SingBoxOutbound | string {
	const query = parsed.url.searchParams;
	const serverName = query.get("sni") ?? undefined;
	const obfs = query.get("obfs");
	const obfsPassword = query.get("obfs-password") ?? query.get("obfs_password");
	const password = decodeComponent(parsed.url.username);

	if (!password) {
		return `Invalid Hysteria2 URI: missing password for ${fallbackTag}`;
	}

	const outbound: SingBoxOutbound = {
		type: "hysteria2",
		tag: parsed.tag,
		server: parsed.server,
		server_port: parsed.serverPort,
		password,
		tls: buildTls(serverName),
	};

	if (obfs) {
		outbound.obfs = {
			type: obfs,
			...(obfsPassword ? { password: obfsPassword } : {}),
		};
	}

	return outbound;
}

function buildTls(
	serverName?: string,
	reality = false,
	query?: URLSearchParams,
): Record<string, unknown> {
	const tls: Record<string, unknown> = { enabled: true };

	if (serverName) {
		tls.server_name = serverName;
	}

	if (reality) {
		tls.reality = {
			enabled: true,
			public_key: query ? getRealityPublicKey(query) : "",
			short_id: query?.get("sid") ?? query?.get("short_id") ?? "",
		};
	}

	return tls;
}

function parsePort(port: string): number | null {
	const parsed = Number(port);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		return null;
	}
	return parsed;
}

function decodeBase64(value: string): string | null {
	try {
		const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
		const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

function getRealityPublicKey(query: URLSearchParams): string {
	return query.get("pbk") ?? query.get("public_key") ?? "";
}

function decodeComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function ok(outbound: SingBoxOutbound): UriParseResult {
	return { outbound, warning: null };
}

function warning(message: string): UriParseResult {
	return { outbound: null, warning: message };
}
