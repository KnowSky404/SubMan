import type { ProxyType } from "$lib/models";

const KNOWN_PROXY_TYPES = new Set<ProxyType>([
	"vless",
	"vmess",
	"trojan",
	"ss",
	"ssr",
	"hysteria2",
	"tuic",
	"anytls",
	"other",
]);

const MULTI_NODE_SCHEME_REGEX =
	/(vless|vmess|trojan|ssr?|hysteria2|hy2|tuic|anytls):\/\//gi;

export function normalizeBase64(value: string): string | null {
	const compact = value.trim().replace(/\s+/g, "");
	if (!compact) {
		return null;
	}
	if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) {
		return null;
	}
	let normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
	const padding = normalized.length % 4;
	if (padding === 1) {
		return null;
	}
	if (padding === 2) {
		normalized += "==";
	} else if (padding === 3) {
		normalized += "=";
	}
	return normalized;
}

export function decodeBase64Utf8(value: string): string | null {
	try {
		const normalized = normalizeBase64(value);
		if (!normalized) {
			return null;
		}
		const binary = atob(normalized);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

export function looksLikeBase64(value: string): boolean {
	return Boolean(normalizeBase64(value));
}

export function splitSubscriptionContentLine(line: string): string[] {
	const value = line.trim();
	if (!value) {
		return [];
	}
	const matches = Array.from(value.matchAll(MULTI_NODE_SCHEME_REGEX));
	if (matches.length === 0) {
		return [value];
	}
	const parts: string[] = [];
	for (let index = 0; index < matches.length; index += 1) {
		const start = matches[index].index ?? 0;
		const end =
			index + 1 < matches.length
				? (matches[index + 1].index ?? value.length)
				: value.length;
		const slice = value.slice(start, end).trim();
		if (slice) {
			parts.push(slice);
		}
	}
	return parts;
}

export function splitNodeSourceLine(line: string): string[] {
	return splitSubscriptionContentLine(line).filter((item) =>
		item.includes("://"),
	);
}

export function normalizeSubscriptionContent(text: string): string {
	return text
		.split(/\r?\n/)
		.flatMap((line) => splitSubscriptionContentLine(line))
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join("\n");
}

export function extractSubscriptionNodeLines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.flatMap((line) => splitNodeSourceLine(line))
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function inferNodeTypeFromRaw(raw: string): ProxyType {
	const index = raw.indexOf("://");
	if (index <= 0) {
		return "other";
	}
	const scheme = raw.slice(0, index).toLowerCase();
	if (scheme === "hy2") {
		return "hysteria2";
	}
	if (KNOWN_PROXY_TYPES.has(scheme as ProxyType)) {
		return scheme as ProxyType;
	}
	return "other";
}

export function inferNodeTypeFromDraft(
	raw: string,
	fallbackType: ProxyType,
): ProxyType {
	const inferredType = inferNodeTypeFromRaw(raw);
	return inferredType === "other" ? fallbackType : inferredType;
}

export function inferNodeNameFromRaw(
	raw: string,
	fallbackName: string,
): string {
	const hashIndex = raw.lastIndexOf("#");
	if (hashIndex > -1) {
		const encoded = raw.slice(hashIndex + 1);
		if (encoded) {
			try {
				const decoded = decodeURIComponent(encoded);
				if (decoded) {
					return decoded;
				}
			} catch {
				return encoded;
			}
		}
	}

	if (raw.startsWith("vmess://")) {
		const payload = raw.slice("vmess://".length);
		const decoded = decodeBase64Utf8(payload);
		if (decoded) {
			try {
				const parsed = JSON.parse(decoded) as { ps?: string };
				if (parsed.ps) {
					return parsed.ps;
				}
			} catch {
				// Ignore invalid vmess payloads.
			}
		}
	}

	return fallbackName;
}

export async function loadSubscriptionContent(
	url: string,
): Promise<{ content: string; warning?: string }> {
	const res = await fetch(url);
	if (!res.ok) {
		return { content: "", warning: `Failed to fetch ${url}` };
	}

	const text = await res.text();
	if (looksLikeBase64(text)) {
		const decoded = decodeBase64Utf8(text);
		if (decoded?.includes("://")) {
			return { content: decoded };
		}
	}

	return { content: text };
}
