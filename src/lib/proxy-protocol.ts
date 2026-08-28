import {
	parseHysteria2Uri,
	type Hysteria2UriIssue,
} from "$lib/hysteria2-uri";
import type { ProxyType } from "$lib/models";

export const PROXY_TYPES = [
	"vless",
	"vmess",
	"trojan",
	"ss",
	"ssr",
	"hysteria2",
	"tuic",
	"anytls",
	"other",
] as const satisfies readonly ProxyType[];

const PROXY_TYPE_SET = new Set<string>(PROXY_TYPES);

export type ProxyUriValidation = {
	scheme: string | null;
	inferredType: ProxyType;
	declaredType: ProxyType | null;
	syntaxValid: boolean;
	coreFieldsValid: boolean;
	issues: string[];
};

export function detectProxyScheme(raw: string): string | null {
	return (
		raw
			.trim()
			.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]
			?.toLowerCase() ?? null
	);
}

export function inferProxyTypeFromScheme(scheme: string | null): ProxyType {
	const normalized = scheme?.toLowerCase() ?? "";
	if (normalized === "hy2") return "hysteria2";
	return PROXY_TYPE_SET.has(normalized) ? (normalized as ProxyType) : "other";
}

export function inferProxyTypeFromRaw(raw: string): ProxyType {
	return inferProxyTypeFromScheme(detectProxyScheme(raw));
}

export function validateProxyUri(
	raw: string,
	declaredType?: ProxyType | null,
): ProxyUriValidation {
	const scheme = detectProxyScheme(raw);
	const inferredType = inferProxyTypeFromScheme(scheme);
	const issues: string[] = [];
	if (!scheme) {
		return {
			scheme: null,
			inferredType: "other",
			declaredType: declaredType ?? null,
			syntaxValid: false,
			coreFieldsValid: false,
			issues: ["malformed-uri"],
		};
	}
	if (/%(?![0-9a-f]{2})/i.test(raw.trim())) {
		return {
			scheme,
			inferredType,
			declaredType: declaredType ?? null,
			syntaxValid: false,
			coreFieldsValid: false,
			issues: ["malformed-uri"],
		};
	}

	if (
		declaredType &&
		declaredType !== "other" &&
		inferredType !== "other" &&
		declaredType !== inferredType
	) {
		issues.push("declared-type-mismatch");
	}

	if (inferredType === "hysteria2") {
		const parsed = parseHysteria2Uri(raw);
		if (!parsed.ok) {
			issues.push(hysteria2ValidationIssue(parsed.issue));
			return {
				scheme,
				inferredType,
				declaredType: declaredType ?? null,
				syntaxValid: parsed.issue !== "malformed-uri",
				coreFieldsValid: false,
				issues,
			};
		}
		return {
			scheme,
			inferredType,
			declaredType: declaredType ?? null,
			syntaxValid: true,
			coreFieldsValid: true,
			issues,
		};
	}

	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return {
			scheme,
			inferredType,
			declaredType: declaredType ?? null,
			syntaxValid: false,
			coreFieldsValid: false,
			issues: ["malformed-uri"],
		};
	}

	if (inferredType === "other") issues.push("unsupported-scheme");

	const decoded = decodeBase64Json(raw, scheme);
	const server = decoded?.server ?? url.hostname;
	const port = decoded?.port ?? Number(url.port);
	if (!server) issues.push("missing-server");
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		issues.push("missing-port");
	}

	if (inferredType === "vless" || inferredType === "vmess") {
		if (!isUuid(decoded?.credential ?? url.username))
			issues.push("missing-uuid");
	}
	if (inferredType === "trojan") {
		if (!(url.username || url.password)) issues.push("missing-password");
	}
	if (inferredType === "tuic") {
		if (!isUuid(url.username)) issues.push("missing-uuid");
		if (!url.password) issues.push("missing-password");
	}
	if (inferredType === "anytls" && !(url.username || url.password)) {
		issues.push("missing-password");
	}
	if (inferredType === "ss" && !decoded?.credential && !url.username) {
		issues.push("missing-credentials");
	}

	const coreIssues = new Set([
		"missing-server",
		"missing-port",
		"missing-uuid",
		"missing-password",
		"missing-credentials",
	]);
	return {
		scheme,
		inferredType,
		declaredType: declaredType ?? null,
		syntaxValid: true,
		coreFieldsValid: !issues.some((issue) => coreIssues.has(issue)),
		issues,
	};
}

function hysteria2ValidationIssue(issue: Hysteria2UriIssue): string {
	switch (issue) {
		case "missing-auth":
			return "missing-password";
		case "missing-server":
			return "missing-server";
		case "invalid-port":
			return "invalid-port";
		case "unsupported-obfs":
			return "unsupported-obfs";
		case "missing-obfs-password":
			return "missing-obfs-password";
		case "unsupported-pin-sha256":
			return "unsupported-pin-sha256";
		case "unsupported-ech":
			return "unsupported-ech";
		case "malformed-uri":
			return "malformed-uri";
	}
}

function isUuid(value: string | null | undefined): boolean {
	return Boolean(
		value &&
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				value,
			),
	);
}

type DecodedProxyAuthority = {
	server: string;
	port: number;
	credential: string;
};

function decodeBase64Json(
	raw: string,
	scheme: string,
): DecodedProxyAuthority | null {
	const payload =
		raw
			.trim()
			.slice(scheme.length + 3)
			.split(/[?#]/, 1)[0] ?? "";
	if (scheme === "vmess") {
		const decoded = decodeBase64Utf8(payload);
		if (!decoded) return null;
		try {
			const data = JSON.parse(decoded) as Record<string, unknown>;
			const server = typeof data.add === "string" ? data.add : "";
			const port = Number(data.port);
			const credential = typeof data.id === "string" ? data.id : "";
			return { server, port, credential };
		} catch {
			return null;
		}
	}
	if (scheme !== "ss") return null;
	try {
		const decoded = decodeBase64Utf8(payload);
		if (!decoded?.includes("@")) return null;
		const url = new URL(`ss://${decoded}`);
		return {
			server: url.hostname,
			port: Number(url.port),
			credential: url.username,
		};
	} catch {
		return null;
	}
}

function decodeBase64Utf8(value: string): string | null {
	const compact = value.trim().replace(/\s+/g, "");
	if (!compact || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null;
	if (compact.includes("=") && !/=+$/.test(compact)) return null;
	const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
	if (normalized.length % 4 === 1) return null;
	try {
		const binary = atob(
			normalized.padEnd(
				normalized.length + ((4 - (normalized.length % 4)) % 4),
				"=",
			),
		);
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Uint8Array.from(binary, (char) => char.charCodeAt(0)),
		);
	} catch {
		return null;
	}
}
