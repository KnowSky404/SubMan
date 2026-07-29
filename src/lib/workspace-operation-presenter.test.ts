import { describe, expect, it } from "bun:test";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import { presentWorkspaceOperation } from "$lib/workspace-operation-presenter";
import type { WorkspaceOperationResult } from "$lib/workspace-operation-result";

const state = createDefaultWorkspaceState("2026-07-29T00:00:00.000Z");

function result(value: Record<string, unknown>): WorkspaceOperationResult {
	return { ...value, state } as WorkspaceOperationResult;
}

describe("Workspace operation presenter", () => {
	it("reserves remote success wording for proven remote commits", () => {
		const presentation = presentWorkspaceOperation(
			result({
				status: "remote-committed",
				durable: true,
				mutationId: "mutation-1",
				revision: 2,
			}),
			{ remoteCommittedMessageKey: "Published successfully" },
		);
		expect(presentation).toEqual({
			tone: "success",
			messageKey: "Published successfully",
			finalizeDraft: true,
			remoteCommitted: true,
		});
	});

	it("maps every locally durable nonterminal outcome to truthful feedback", () => {
		const cases: Array<[WorkspaceOperationResult, string]> = [
			[
				result({
					status: "local-durable-queued",
					durable: true,
					mutationId: "mutation-1",
				}),
				"Saved locally and queued for Workspace sync",
			],
			[
				result({
					status: "peer-owned",
					durable: true,
					mutationId: "mutation-1",
				}),
				"Saved locally; another tab is synchronizing",
			],
			[
				result({
					status: "retry-scheduled",
					durable: true,
					mutationId: "mutation-1",
					attempt: 2,
					nextAttemptAt: 1_000,
					lastErrorCode: "rate_limited",
				}),
				"Saved locally; retrying Workspace sync",
			],
		];
		for (const [operation, messageKey] of cases) {
			const presentation = presentWorkspaceOperation(operation);
			expect(presentation.messageKey).toBe(messageKey);
			expect(presentation.tone).toBe("info");
			expect(presentation.finalizeDraft).toBe(true);
			expect(presentation.remoteCommitted).toBe(false);
		}
	});

	it("distinguishes manual, blocked, rejected, and uncertain outcomes", () => {
		const manual = presentWorkspaceOperation(
			result({
				status: "local-durable",
				durable: true,
				mutationId: null,
				mode: "manual",
			}),
		);
		expect(manual.messageKey).toBe("Saved locally; manual push required");
		expect(manual.finalizeDraft).toBe(true);

		const blocked = presentWorkspaceOperation(
			result({
				status: "conflict-or-blocked",
				durable: true,
				mutationId: "mutation-1",
				code: "auth_required",
				disposition: "auth-required",
				messageKey: null,
			}),
		);
		expect(blocked.messageParams).toEqual({ error: "auth_required" });
		expect(blocked.finalizeDraft).toBe(false);

		const rejected = presentWorkspaceOperation({
			status: "rejected-before-durable-commit",
			durable: false,
			mutationId: "mutation-1",
			code: "quota-exceeded",
			message: "Quota exceeded",
		});
		expect(rejected.tone).toBe("error");
		expect(rejected.finalizeDraft).toBe(false);

		const uncertain = presentWorkspaceOperation(
			result({
				status: "commit-acknowledgement-uncertain",
				durable: "uncertain",
				mutationId: "mutation-1",
				code: "cache_refresh_failed",
			}),
		);
		expect(uncertain.tone).toBe("info");
		expect(uncertain.finalizeDraft).toBe(false);
	});
});
