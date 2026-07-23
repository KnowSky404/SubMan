import { describe, expect, it } from "bun:test";
import {
	scheduleWorkspaceRetry,
	WORKSPACE_RETRY_DEFAULTS,
} from "$lib/workspace-retry";

describe("Workspace retry policy", () => {
	it("uses bounded exponential full jitter", () => {
		expect(
			scheduleWorkspaceRetry({
				previousAttempt: 0,
				now: 10_000,
				random: () => 0,
			}),
		).toEqual({ attempt: 1, delayMs: 0, nextAttemptAt: 10_000 });
		expect(
			scheduleWorkspaceRetry({
				previousAttempt: 3,
				now: 10_000,
				random: () => 0.5,
			}),
		).toEqual({ attempt: 4, delayMs: 4_000, nextAttemptAt: 14_000 });
		const capped = scheduleWorkspaceRetry({
			previousAttempt: 30,
			now: 10_000,
			random: () => 0.999_999,
		});
		expect(capped.delayMs <= WORKSPACE_RETRY_DEFAULTS.maximumDelayMs).toBe(
			true,
		);
	});

	it("honors server retry guidance as a lower bound", () => {
		expect(
			scheduleWorkspaceRetry({
				previousAttempt: 1,
				now: 10_000,
				random: () => 0,
				guidance: {
					retryAfterMs: 15_000,
					rateLimitResetAt: 40_000,
				},
			}),
		).toEqual({ attempt: 2, delayMs: 30_000, nextAttemptAt: 40_000 });
	});

	it("does not cap explicit upstream retry guidance", () => {
		const schedule = scheduleWorkspaceRetry({
			previousAttempt: 20,
			now: 1_000,
			random: () => 0.5,
			guidance: { retryAfterMs: 900_000 },
		});
		expect(schedule.delayMs).toBe(900_000);
		expect(schedule.nextAttemptAt).toBe(901_000);
	});

	it("rejects unsafe timing and random inputs", () => {
		expect(() =>
			scheduleWorkspaceRetry({
				previousAttempt: -1,
				now: 0,
				random: () => 0.5,
			}),
		).toThrow("previousAttempt");
		expect(() =>
			scheduleWorkspaceRetry({
				previousAttempt: 0,
				now: 0,
				random: () => 1,
			}),
		).toThrow("random");
	});
});
