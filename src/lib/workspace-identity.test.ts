import { describe, expect, test } from "bun:test";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import {
	checkWorkspaceIdentity,
	requireWorkspaceIdentity,
	withWorkspaceBinding,
} from "$lib/workspace-identity";
import { createWorkspaceV2LocalState } from "$lib/workspace-v2-state";

const now = "2026-07-23T00:00:00.000Z";

describe("Workspace identity invariant", () => {
	test("treats the V2 binding as the connected identity source", () => {
		const binding = createWorkspaceV2LocalState("gist-one");
		const state = withWorkspaceBinding(
			createDefaultWorkspaceState(now),
			binding,
		);
		expect(checkWorkspaceIdentity(state, binding)).toEqual({
			status: "connected",
			gistId: "gist-one",
			workspaceId: "gist:gist-one",
		});
	});

	test("blocks dangerous operations when the AppState cache disagrees", () => {
		const binding = createWorkspaceV2LocalState("gist-one");
		const state = {
			...createDefaultWorkspaceState(now),
			activeGistId: "gist-two",
		};
		expect(checkWorkspaceIdentity(state, binding).status).toBe("mismatch");
		expect(() => requireWorkspaceIdentity(state, binding)).toThrow(
			"Workspace identity requires repair",
		);
	});
});
