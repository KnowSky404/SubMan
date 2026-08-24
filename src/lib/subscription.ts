import type { ProxyType } from "$lib/models";
import { inferProxyTypeFromRaw } from "$lib/proxy-protocol";

export const SUBSCRIPTION_FETCH_LIMITS = {
	timeoutMs: 15_000,
	maxBytes: 4 * 1024 * 1024,
} as const;

export type SubscriptionFetchErrorCode =
	| "timeout"
	| "network-or-cors"
	| "http-4xx"
	| "http-5xx"
	| "http-error"
	| "response-too-large"
	| "malformed-utf8"
	| "malformed-base64"
	| "empty-subscription";

export type SubscriptionFetchError = {
	code: SubscriptionFetchErrorCode;
	message: string;
	status?: number;
};

export type SubscriptionFetchResult = {
	content: string;
	warning?: string;
	error?: SubscriptionFetchError;
};

export type SubscriptionFetchImpl = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export type SubscriptionFetchOptions = {
	timeoutMs?: number;
	maxBytes?: number;
	fetchImpl?: SubscriptionFetchImpl;
};

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
	return inferProxyTypeFromRaw(raw);
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
	options: SubscriptionFetchOptions = {},
): Promise<SubscriptionFetchResult> {
	const timeoutMs = options.timeoutMs ?? SUBSCRIPTION_FETCH_LIMITS.timeoutMs;
	const maxBytes = options.maxBytes ?? SUBSCRIPTION_FETCH_LIMITS.maxBytes;
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		let res: Response;
		try {
			res = await fetchImpl(url, { signal: controller.signal });
		} catch {
			if (controller.signal.aborted) {
				return failure(
					"timeout",
					`Subscription request timed out after ${timeoutMs} ms.`,
				);
			}
			return failure(
				"network-or-cors",
				"Subscription request failed due to network or browser CORS policy.",
			);
		}

		if (!res.ok) {
			const family =
				res.status >= 500
					? "http-5xx"
					: res.status >= 400
						? "http-4xx"
						: "http-error";
			return failure(
				family,
				`Subscription returned HTTP ${family === "http-5xx" ? "5xx" : family === "http-4xx" ? "4xx" : "error"} (${res.status}).`,
				res.status,
			);
		}

		const declaredLength = Number(res.headers.get("content-length"));
		if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes) {
			return failure(
				"response-too-large",
				`Subscription response is too large; the limit is ${maxBytes} bytes.`,
			);
		}
		const textResult = await readBoundedResponseText(
			res,
			maxBytes,
			controller.signal,
		);
		if (!textResult.ok) return failure(textResult.code, textResult.message);

		const text = textResult.text;
		if (!text.trim()) {
			return failure("empty-subscription", "Subscription response is empty.");
		}

		const decoded = decodeBase64Utf8(text);
		if (decoded?.includes("://")) return { content: decoded };
		if (isMalformedBase64Candidate(text)) {
			return failure(
				"malformed-base64",
				"Subscription contains malformed base64 content.",
			);
		}

		return { content: text };
	} finally {
		clearTimeout(timeoutId);
	}
}

type BoundedTextResult =
	| { ok: true; text: string }
	| {
			ok: false;
			code:
				| "timeout"
				| "network-or-cors"
				| "response-too-large"
				| "malformed-utf8";
			message: string;
	  };

async function readBoundedResponseText(
	response: Response,
	maxBytes: number,
	signal?: AbortSignal,
): Promise<BoundedTextResult> {
	if (!response.body) {
		return { ok: true, text: "" };
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let bytes = 0;
	let text = "";
	try {
		while (true) {
			let chunk: ReadableStreamReadResult<Uint8Array>;
			try {
				chunk = await reader.read();
			} catch {
				if (signal?.aborted) {
					return {
						ok: false,
						code: "timeout",
						message:
							"Subscription request timed out while reading the response.",
					};
				}
				return {
					ok: false,
					code: "network-or-cors",
					message:
						"Subscription response failed due to network or browser CORS policy.",
				};
			}
			const { done, value } = chunk;
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				try {
					await reader.cancel();
				} catch {
					// The size limit remains the authoritative classification.
				}
				return {
					ok: false,
					code: "response-too-large",
					message: `Subscription response is too large; the limit is ${maxBytes} bytes.`,
				};
			}
			try {
				text += decoder.decode(value, { stream: true });
			} catch {
				return {
					ok: false,
					code: "malformed-utf8",
					message: "Subscription response is not valid UTF-8.",
				};
			}
		}
		try {
			text += decoder.decode();
		} catch {
			return {
				ok: false,
				code: "malformed-utf8",
				message: "Subscription response is not valid UTF-8.",
			};
		}
		return { ok: true, text };
	} catch {
		return {
			ok: false,
			code: signal?.aborted ? "timeout" : "network-or-cors",
			message: signal?.aborted
				? "Subscription request timed out while reading the response."
				: "Subscription response failed due to network or browser CORS policy.",
		};
	} finally {
		reader.releaseLock();
	}
}

function isMalformedBase64Candidate(value: string): boolean {
	const compact = value.trim().replace(/\s+/g, "");
	if (!compact || compact.includes("://")) return false;
	if (looksLikeBase64(value)) return true;
	return /^[A-Za-z0-9+/_-]{4,}[^A-Za-z0-9+/_=-]/.test(compact);
}

function failure(
	code: SubscriptionFetchErrorCode,
	message: string,
	status?: number,
): SubscriptionFetchResult {
	return {
		content: "",
		warning: message,
		error: { code, message, ...(status === undefined ? {} : { status }) },
	};
}
