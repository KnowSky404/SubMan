import { describe, expect, it } from "bun:test";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import {
	createWorkspaceMutationDiagnostics,
	exportWorkspaceDiagnostics,
	exportWorkspaceDiagnosticsSnapshot,
	type WorkspaceDiagnosticsError,
	type WorkspaceDiagnosticsQuarantine,
	type WorkspaceDiagnosticsSnapshot,
} from "$lib/workspace-diagnostics";
import type { WorkspaceMutation } from "$lib/workspace-mutation";

const T1 = "2026-07-23T12:00:00.000Z";
const WORKSPACE_ID = "gist:diagnostic-workspace";

function mutation(
	kind: WorkspaceMutation["kind"],
	payload: unknown,
	index: number,
) {
	return {
		mutationId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
		workspaceId: WORKSPACE_ID,
		expectedRevision: index,
		createdAt: T1,
		kind,
		payload,
	};
}

describe("Workspace diagnostics", () => {
	it("hashes mutation payloads without exporting sensitive business data", async () => {
		const canaries = {
			proxy: "vless://user:password@example.com:443?token=proxy-query-secret",
			subscription: "https://subscription.example/list?access_token=sub-secret",
			aggregateOutput: "aggregate-output-secret",
			clientOutput: "client-export-output-secret",
			reconcile: "reconcile-full-document-secret",
		};
		const sources = [
			mutation("node.upsert", { operation: "replace", raw: canaries.proxy }, 1),
			mutation(
				"subscription.upsert",
				{ subscription: { url: canaries.subscription } },
				2,
			),
			mutation(
				"aggregate.publish",
				{
					output: {
						fileName: "aggregate.txt",
						content: canaries.aggregateOutput,
					},
				},
				3,
			),
			mutation(
				"client-export.publish",
				{ output: { fileName: "client.json", content: canaries.clientOutput } },
				4,
			),
			mutation(
				"workspace.reconcile",
				{ data: { nodes: [{ raw: canaries.reconcile }] } },
				5,
			),
		];
		const mutations = await Promise.all(
			sources.map(createWorkspaceMutationDiagnostics),
		);

		for (const [index, diagnostic] of mutations.entries()) {
			const serialized = JSON.stringify(sources[index]?.payload);
			expect(diagnostic.payloadBytes).toBe(
				new TextEncoder().encode(serialized).byteLength,
			);
			expect(diagnostic.payloadSha256).toHaveLength(64);
		}
		const output = JSON.stringify(mutations);
		for (const canary of Object.values(canaries)) {
			expect(output).not.toContain(canary);
		}
		expect(output).not.toContain('"payload"');
	});

	it("exports only safe metadata and never reads quarantine raw values", async () => {
		const secrets = {
			auth: "github_pat_auth_secret",
			session: "session-storage-token-secret",
			persistent: "persistent-storage-token-secret",
			quarantine: "quarantine-raw-secret",
			errorMessage: "vless://error-user:error-pass@example.com",
			errorStack: "stack-with-subscription-token-secret",
			errorString: "arbitrary-error-string-secret",
		};
		let quarantineRawReads = 0;
		const quarantine = {
			key: "workspace:quarantine:one",
			bytes: 321,
			createdAt: T1,
			get raw() {
				quarantineRawReads += 1;
				return secrets.quarantine;
			},
		} satisfies WorkspaceDiagnosticsQuarantine & { readonly raw: string };
		const error = {
			code: "gist_read_failed",
			disposition: "retryable-upstream" as const,
			message: secrets.errorMessage,
			stack: secrets.errorStack,
			toString: () => secrets.errorString,
		} satisfies WorkspaceDiagnosticsError & {
			message: string;
			stack: string;
			toString: () => string;
		};
		const mutationDiagnostic = await createWorkspaceMutationDiagnostics(
			mutation("node.delete", { id: "node-1", token: secrets.auth }, 6),
		);
		const snapshot = {
			workspace: {
				workspaceId: WORKSPACE_ID,
				revision: 17,
				mode: "automatic" as const,
			},
			counts: {
				nodes: 3,
				subscriptions: 2,
				aggregates: 1,
				publishTargets: 1,
				clientExports: 1,
				activeQueue: 1,
				totalQueue: 4,
				orphanedWorkspaces: 1,
				blockedMutations: 1,
				deadLetters: 1,
			},
			mutations: [mutationDiagnostic],
			retry: {
				attempt: 2,
				nextAttemptAt: 1_780_000_000_000,
				retryAfterMs: 45_000,
				lastErrorCode: "rate_limit",
			},
			errors: [error],
			quarantines: [quarantine],
			authToken: secrets.auth,
			sessionToken: secrets.session,
			persistentToken: secrets.persistent,
			get quarantinePayloads(): never {
				throw new Error("Diagnostics read quarantine payloads");
			},
		} satisfies WorkspaceDiagnosticsSnapshot & {
			authToken: string;
			sessionToken: string;
			persistentToken: string;
			readonly quarantinePayloads: never;
		};

		const output = await exportWorkspaceDiagnosticsSnapshot(
			snapshot,
			() => new Date(T1),
		);
		const parsed = JSON.parse(output);

		expect(quarantineRawReads).toBe(0);
		expect(parsed.workspace).toEqual({
			workspaceId: WORKSPACE_ID,
			revision: 17,
			mode: "automatic",
		});
		expect(parsed.mutations).toEqual([mutationDiagnostic]);
		expect(parsed.retry).toEqual(snapshot.retry);
		expect(parsed.errors).toEqual([
			{ code: "gist_read_failed", disposition: "retryable-upstream" },
		]);
		expect(parsed.quarantines).toEqual([
			{ key: "workspace:quarantine:one", bytes: 321, createdAt: T1 },
		]);
		for (const secret of Object.values(secrets)) {
			expect(output).not.toContain(secret);
		}
		expect(output).not.toContain("message");
		expect(output).not.toContain("stack");
		expect(output).not.toContain("quarantinePayloads");
	});

	it("keeps the synchronous compatibility export metadata-only", () => {
		const canary = "vless://compat-user:compat-pass@example.com?token=secret";
		const state = createDefaultWorkspaceState();
		state.nodes.push({
			id: "node-1",
			name: "node",
			type: "vless",
			raw: canary,
			tags: [],
			enabled: true,
			updatedAt: T1,
			source: "single",
		});

		const output = exportWorkspaceDiagnostics(state, () => new Date(T1));
		expect(output).not.toContain(canary);
		expect(JSON.parse(output).counts.nodes).toBe(1);
	});
});
