import { describe, expect, it } from "bun:test";
import { hashWorkspaceId, logWorkerEvent } from "$lib/server/observability";

describe("worker observability", () => {
	it("emits only allowlisted redacted fields", () => {
		const secret = "github-token-must-not-appear";
		const logged: string[] = [];
		const originalError = console.error;
		console.error = (value: string) => logged.push(value);

		try {
			logWorkerEvent("error", "test.failure", {
				errorCode: "server_error",
				requestId: "request-1",
				token: secret,
			} as never);
		} finally {
			console.error = originalError;
		}

		expect(logged).toHaveLength(1);
		expect(logged[0]).not.toContain(secret);
		expect(JSON.parse(logged[0] ?? "")).toEqual({
			source: "subman",
			event: "test.failure",
			errorCode: "server_error",
			requestId: "request-1",
		});
	});

	it("hashes workspace identifiers before they enter logs", async () => {
		const hash = await hashWorkspaceId("gist:private-gist-id");

		expect(hash).toHaveLength(16);
		expect(hash).not.toContain("private-gist-id");
		expect(await hashWorkspaceId("gist:private-gist-id")).toBe(hash);
	});
});
