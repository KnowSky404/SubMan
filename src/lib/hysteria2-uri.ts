import {
	getSingBoxTarget,
	type SingBoxTarget,
	supportsHysteria2Obfs,
	supportsUtlsFingerprint,
} from "$lib/client-export/target";

export type Hysteria2Obfs = {
	type: "salamander" | "gecko";
	password: string;
};

export type ParsedHysteria2Uri = {
	scheme: "hysteria2" | "hy2";
	server: string;
	serverPort: number | null;
	serverPorts: string[];
	password: string;
	tag: string | null;
	query: URLSearchParams;
	obfs: Hysteria2Obfs | null;
};

export type Hysteria2UriIssue =
	| "malformed-uri"
	| "missing-auth"
	| "missing-server"
	| "invalid-port"
	| "unsupported-obfs"
	| "missing-obfs-password"
	| "unsupported-parameter"
	| "unsupported-utls-fingerprint"
	| "unsupported-pin-sha256"
	| "unsupported-ech";

export type Hysteria2UriParseResult =
	| { ok: true; value: ParsedHysteria2Uri }
	| { ok: false; issue: Hysteria2UriIssue };

type PortSegment = {
	start: number;
	end: number;
	isRange: boolean;
};

const DEFAULT_HYSTERIA2_PORT = 443;
const HYSTERIA2_SCHEME_PATTERN = /^(hysteria2|hy2):\/\//i;
const INVALID_PERCENT_ENCODING = /%(?![0-9a-f]{2})/i;
const HYSTERIA2_QUERY_PARAMETERS = new Set([
	"obfs",
	"obfs-password",
	"obfs_password",
	"sni",
	"serverName",
	"server_name",
	"insecure",
	"allowInsecure",
	"allow_insecure",
	"skip-cert-verify",
	"alpn",
	"fp",
	"fingerprint",
	"network",
	"pinSHA256",
	"ech",
]);

export function parseHysteria2Uri(
	raw: string,
	target: SingBoxTarget = getSingBoxTarget(),
): Hysteria2UriParseResult {
	const normalized = raw.trim();
	const schemeMatch = normalized.match(HYSTERIA2_SCHEME_PATTERN);
	if (!schemeMatch || INVALID_PERCENT_ENCODING.test(normalized)) {
		return failure("malformed-uri");
	}

	const scheme = schemeMatch[1].toLowerCase() as "hysteria2" | "hy2";
	const remainder = normalized.slice(schemeMatch[0].length);
	const fragmentIndex = remainder.indexOf("#");
	const beforeFragment =
		fragmentIndex >= 0 ? remainder.slice(0, fragmentIndex) : remainder;
	const fragment = fragmentIndex >= 0 ? remainder.slice(fragmentIndex + 1) : "";
	if (fragment.includes("#")) return failure("malformed-uri");

	const queryIndex = beforeFragment.indexOf("?");
	const beforeQuery =
		queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment;
	const queryString =
		queryIndex >= 0 ? beforeFragment.slice(queryIndex + 1) : "";
	const slashIndex = beforeQuery.indexOf("/");
	const authority =
		slashIndex >= 0 ? beforeQuery.slice(0, slashIndex) : beforeQuery;
	const path = slashIndex >= 0 ? beforeQuery.slice(slashIndex) : "";
	if (path && path !== "/") return failure("malformed-uri");

	const atIndex = authority.lastIndexOf("@");
	if (atIndex < 0) return failure("missing-auth");
	if (authority.slice(0, atIndex).includes("@")) {
		return failure("malformed-uri");
	}

	const rawAuth = authority.slice(0, atIndex);
	const serverAuthority = authority.slice(atIndex + 1);
	const password = parseAuthentication(rawAuth);
	if (!password) return failure("missing-auth");

	const serverResult = parseServerAuthority(serverAuthority);
	if (serverResult.ok === false) {
		return failure(serverResult.issue);
	}

	const query = new URLSearchParams(queryString);
	for (const name of query.keys()) {
		if (!HYSTERIA2_QUERY_PARAMETERS.has(name)) {
			return failure("unsupported-parameter");
		}
	}
	if (hasNonEmptyQueryValue(query, "pinSHA256")) {
		return failure("unsupported-pin-sha256");
	}
	if (hasNonEmptyQueryValue(query, "ech")) {
		return failure("unsupported-ech");
	}
	const fingerprint = firstNonEmptyQueryValue(query, "fp", "fingerprint");
	if (
		fingerprint &&
		!supportsUtlsFingerprint(target, fingerprint.toLowerCase())
	) {
		return failure("unsupported-utls-fingerprint");
	}

	const obfsType = firstNonEmptyQueryValue(query, "obfs")?.toLowerCase();
	let obfs: Hysteria2Obfs | null = null;
	if (obfsType) {
		if (!supportsHysteria2Obfs(target, obfsType)) {
			return failure("unsupported-obfs");
		}
		const obfsPassword = firstNonEmptyQueryValue(
			query,
			"obfs-password",
			"obfs_password",
		);
		if (!obfsPassword) return failure("missing-obfs-password");
		obfs = { type: obfsType, password: obfsPassword };
	}

	let tag: string | null = null;
	if (fragment) {
		try {
			tag = decodeURIComponent(fragment) || null;
		} catch {
			return failure("malformed-uri");
		}
	}

	return {
		ok: true,
		value: {
			scheme,
			server: serverResult.server,
			serverPort: serverResult.serverPort,
			serverPorts: serverResult.serverPorts,
			password,
			tag,
			query,
			obfs,
		},
	};
}

function parseAuthentication(rawAuth: string): string | null {
	if (!rawAuth) return null;
	const separatorIndex = rawAuth.indexOf(":");
	try {
		if (separatorIndex < 0) {
			return decodeURIComponent(rawAuth) || null;
		}
		if (rawAuth.indexOf(":", separatorIndex + 1) >= 0) return null;
		const username = decodeURIComponent(rawAuth.slice(0, separatorIndex));
		const password = decodeURIComponent(rawAuth.slice(separatorIndex + 1));
		if (!username || !password) return null;
		return `${username}:${password}`;
	} catch {
		return null;
	}
}

function parseServerAuthority(value: string):
	| {
			ok: true;
			server: string;
			serverPort: number | null;
			serverPorts: string[];
	  }
	| { ok: false; issue: "missing-server" | "invalid-port" | "malformed-uri" } {
	if (!value) return failure("missing-server");

	let hostLiteral = "";
	let portSpec: string | null = null;
	if (value.startsWith("[")) {
		const closingBracket = value.indexOf("]");
		if (closingBracket < 0) return failure("malformed-uri");
		hostLiteral = value.slice(0, closingBracket + 1);
		const suffix = value.slice(closingBracket + 1);
		if (suffix) {
			if (!suffix.startsWith(":")) return failure("malformed-uri");
			portSpec = suffix.slice(1);
		}
	} else {
		const colonIndex = value.lastIndexOf(":");
		if (colonIndex >= 0) {
			hostLiteral = value.slice(0, colonIndex);
			portSpec = value.slice(colonIndex + 1);
			if (hostLiteral.includes(":")) return failure("malformed-uri");
		} else {
			hostLiteral = value;
		}
	}

	const server = normalizeServer(hostLiteral);
	if (!server) return failure("missing-server");
	if (portSpec === "") return failure("invalid-port");

	const ports = parsePortSpec(portSpec);
	if (!ports) return failure("invalid-port");
	const usesServerPorts =
		ports.length > 1 || ports.some((segment) => segment.isRange);
	if (!usesServerPorts) {
		return {
			ok: true,
			server,
			serverPort: ports[0].start,
			serverPorts: [],
		};
	}

	return {
		ok: true,
		server,
		serverPort: null,
		serverPorts: ports.map((segment) => `${segment.start}:${segment.end}`),
	};
}

function normalizeServer(hostLiteral: string): string | null {
	if (!hostLiteral) return null;
	try {
		const probe = new URL(`http://${hostLiteral}:443`);
		if (!probe.hostname || probe.username || probe.password) return null;
		const hostname = probe.hostname;
		return hostname.startsWith("[") && hostname.endsWith("]")
			? hostname.slice(1, -1)
			: hostname;
	} catch {
		return null;
	}
}

function parsePortSpec(value: string | null): PortSegment[] | null {
	if (value === null) {
		return [
			{
				start: DEFAULT_HYSTERIA2_PORT,
				end: DEFAULT_HYSTERIA2_PORT,
				isRange: false,
			},
		];
	}

	const rawSegments = value.split(",");
	if (rawSegments.length === 0 || rawSegments.some((segment) => !segment)) {
		return null;
	}

	const segments: PortSegment[] = [];
	for (const rawSegment of rawSegments) {
		const match = rawSegment.match(/^(\d+)(?:-(\d+))?$/);
		if (!match) return null;
		const start = Number(match[1]);
		const end = match[2] ? Number(match[2]) : start;
		if (!isValidPort(start) || !isValidPort(end) || start > end) {
			return null;
		}
		segments.push({ start, end, isRange: Boolean(match[2]) });
	}
	return segments;
}

function isValidPort(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 1 && value <= 65_535;
}

function firstNonEmptyQueryValue(
	query: URLSearchParams,
	...names: string[]
): string | null {
	for (const name of names) {
		for (const value of query.getAll(name)) {
			if (value.trim()) return value.trim();
		}
	}
	return null;
}

function hasNonEmptyQueryValue(query: URLSearchParams, name: string): boolean {
	return query.getAll(name).some((value) => Boolean(value.trim()));
}

function failure<T extends Hysteria2UriIssue>(
	issue: T,
): { ok: false; issue: T } {
	return { ok: false, issue };
}
