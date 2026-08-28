import {
	SUBSCRIPTION_FETCH_LIMITS,
	type SubscriptionFetchError,
	type SubscriptionFetchErrorCode,
} from "./subscription";

export type SubscriptionFetchDiagnostic = {
	code: SubscriptionFetchErrorCode;
	status?: number;
};

export type SubscriptionFetchDiagnosticPresentation = {
	titleKey: string;
	detailKey: string;
	params?: Record<string, string | number>;
};

const RESPONSE_LIMIT_MIB = SUBSCRIPTION_FETCH_LIMITS.maxBytes / (1024 * 1024);

export function toSubscriptionFetchDiagnostic(
	error: SubscriptionFetchError,
): SubscriptionFetchDiagnostic {
	return error.status === undefined
		? { code: error.code }
		: { code: error.code, status: error.status };
}

export function presentSubscriptionFetchDiagnostic(
	diagnostic: SubscriptionFetchDiagnostic,
): SubscriptionFetchDiagnosticPresentation {
	const status = diagnostic.status;

	switch (diagnostic.code) {
		case "timeout":
			return {
				titleKey: "Subscription request timed out",
				detailKey:
					"The provider did not respond in time. Check its availability and retry.",
			};
		case "network-or-cors":
			return {
				titleKey: "Subscription could not be reached",
				detailKey:
					"Check your network and confirm the provider allows browser requests (CORS), then retry.",
			};
		case "http-4xx":
			if (status === 401 || status === 403) {
				return {
					titleKey: "Subscription access was rejected (HTTP {status})",
					detailKey:
						"Check whether the subscription link is still authorized or has expired.",
					params: { status },
				};
			}
			if (status === 404) {
				return {
					titleKey: "Subscription endpoint was not found (HTTP 404)",
					detailKey:
						"Check whether the provider changed or removed the endpoint.",
				};
			}
			if (status === 429) {
				return {
					titleKey: "Subscription request was rate limited (HTTP 429)",
					detailKey:
						"Wait before retrying or reduce how often this source is refreshed.",
				};
			}
			return {
				titleKey: "Subscription request was rejected (HTTP {status})",
				detailKey: "Check the subscription link and provider access settings.",
				params: { status: status ?? "4xx" },
			};
		case "http-5xx":
			return {
				titleKey: "Subscription provider is unavailable (HTTP {status})",
				detailKey: "The provider returned a server error. Retry later.",
				params: { status: status ?? "5xx" },
			};
		case "http-error":
			return {
				titleKey: "Subscription returned an unexpected HTTP status",
				detailKey: "Check the provider response and retry.",
			};
		case "response-too-large":
			return {
				titleKey: "Subscription response is too large",
				detailKey:
					"The response exceeds the {limit} MiB browser limit. Split or reduce the subscription before retrying.",
				params: { limit: RESPONSE_LIMIT_MIB },
			};
		case "malformed-utf8":
			return {
				titleKey: "Subscription response is not valid UTF-8",
				detailKey:
					"Ask the provider for UTF-8 text or a valid Base64-encoded subscription.",
			};
		case "malformed-base64":
			return {
				titleKey: "Subscription Base64 payload is malformed",
				detailKey:
					"Refresh the link or ask the provider to regenerate the subscription payload.",
			};
		case "empty-subscription":
			return {
				titleKey: "Subscription returned no content",
				detailKey:
					"Confirm the subscription is active and contains proxy node URIs.",
			};
	}

	const exhaustive: never = diagnostic.code;
	return exhaustive;
}
