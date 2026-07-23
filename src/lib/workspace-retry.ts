export const WORKSPACE_RETRY_DEFAULTS = {
	baseDelayMs: 1_000,
	maximumDelayMs: 5 * 60_000,
} as const;

export type WorkspaceRetryGuidance = {
	retryAfterMs?: number | null;
	rateLimitResetAt?: number | null;
};

export type WorkspaceRetrySchedule = {
	attempt: number;
	delayMs: number;
	nextAttemptAt: number;
};

function safeInteger(value: number, name: string, minimum = 0): number {
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(`${name} is invalid`);
	}
	return value;
}

function optionalDelay(value: number | null | undefined, name: string): number {
	return value == null ? 0 : safeInteger(value, name);
}

export function scheduleWorkspaceRetry(input: {
	previousAttempt: number;
	now: number;
	random: () => number;
	guidance?: WorkspaceRetryGuidance;
	baseDelayMs?: number;
	maximumDelayMs?: number;
}): WorkspaceRetrySchedule {
	const previousAttempt = safeInteger(input.previousAttempt, "previousAttempt");
	const now = safeInteger(input.now, "now");
	const baseDelayMs = safeInteger(
		input.baseDelayMs ?? WORKSPACE_RETRY_DEFAULTS.baseDelayMs,
		"baseDelayMs",
		1,
	);
	const maximumDelayMs = safeInteger(
		input.maximumDelayMs ?? WORKSPACE_RETRY_DEFAULTS.maximumDelayMs,
		"maximumDelayMs",
		baseDelayMs,
	);
	const random = input.random();
	if (!Number.isFinite(random) || random < 0 || random >= 1) {
		throw new Error(
			"random must return a value from 0 inclusive to 1 exclusive",
		);
	}

	const attempt = safeInteger(previousAttempt + 1, "attempt", 1);
	const exponent = Math.min(previousAttempt, 30);
	const jitterCeiling = Math.min(maximumDelayMs, baseDelayMs * 2 ** exponent);
	const jitterDelay = Math.floor(random * (jitterCeiling + 1));
	const retryAfterDelay = optionalDelay(
		input.guidance?.retryAfterMs,
		"retryAfterMs",
	);
	const rateLimitResetAt = input.guidance?.rateLimitResetAt;
	const resetDelay =
		rateLimitResetAt == null
			? 0
			: Math.max(0, safeInteger(rateLimitResetAt, "rateLimitResetAt") - now);
	const delayMs = Math.max(jitterDelay, retryAfterDelay, resetDelay);

	return {
		attempt,
		delayMs,
		nextAttemptAt: safeInteger(now + delayMs, "nextAttemptAt"),
	};
}
