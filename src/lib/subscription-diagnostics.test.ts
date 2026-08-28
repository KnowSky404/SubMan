import { describe, expect, it } from "bun:test";
import type { SubscriptionFetchErrorCode } from "./subscription";
import {
	presentSubscriptionFetchDiagnostic,
	toSubscriptionFetchDiagnostic,
} from "./subscription-diagnostics";

const ALL_CODES: SubscriptionFetchErrorCode[] = [
	"timeout",
	"network-or-cors",
	"http-4xx",
	"http-5xx",
	"http-error",
	"response-too-large",
	"malformed-utf8",
	"malformed-base64",
	"empty-subscription",
];

describe("subscription fetch diagnostics", () => {
	it("provides actionable presentation keys for every fetch error code", () => {
		for (const code of ALL_CODES) {
			const presentation = presentSubscriptionFetchDiagnostic({ code });
			expect(presentation.titleKey).not.toBe("");
			expect(presentation.detailKey).not.toBe("");
		}
	});

	it("removes raw fetch messages before diagnostics reach the UI", () => {
		const diagnostic = toSubscriptionFetchDiagnostic({
			code: "network-or-cors",
			message:
				"https://user:secret@subscription.example/list?token=secret failed",
		});

		expect(diagnostic).toEqual({ code: "network-or-cors" });
		expect(JSON.stringify(diagnostic)).not.toContain("secret");
		expect(
			JSON.stringify(presentSubscriptionFetchDiagnostic(diagnostic)),
		).not.toContain("secret");
	});

	it("provides status-specific guidance for access and rate-limit failures", () => {
		const accessFailure = presentSubscriptionFetchDiagnostic({
			code: "http-4xx",
			status: 403,
		});
		expect(accessFailure.titleKey).toBe(
			"Subscription access was rejected (HTTP {status})",
		);
		expect(accessFailure.params).toEqual({ status: 403 });
		expect(
			presentSubscriptionFetchDiagnostic({
				code: "http-4xx",
				status: 429,
			}).titleKey,
		).toBe("Subscription request was rate limited (HTTP 429)");
	});
});
