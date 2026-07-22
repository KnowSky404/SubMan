import * as bunTest from "bun:test";

const { describe, expect, it } = bunTest;
const bun = bunTest as unknown as {
	mock: {
		module: (specifier: string, factory: () => unknown) => void;
	};
};

bun.mock.module("$env/dynamic/private", () => ({ env: {} }));

describe("Server API error logging", () => {
	it("does not expose credentials from unknown errors in logs or responses", async () => {
		const { handleApiError } = await import("$lib/server/api/routes");
		const token = "github-token-that-must-not-be-logged";
		const logged: unknown[][] = [];
		const originalError = console.error;
		console.error = (...values: unknown[]) => {
			logged.push(values);
		};

		let response: Response;
		try {
			response = handleApiError(new Error(`upstream echoed ${token}`));
		} finally {
			console.error = originalError;
		}

		const body = await response.text();
		expect(response.status).toBe(500);
		expect(JSON.stringify(logged)).not.toContain(token);
		expect(body).not.toContain(token);
		expect(logged).toEqual([
			[
				JSON.stringify({
					message: "Unhandled server API error",
					errorType: "error",
				}),
			],
		]);
	});
});
