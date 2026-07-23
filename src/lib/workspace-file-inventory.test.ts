import { describe, expect, it } from "bun:test";
import {
	canDeleteWorkspaceFile,
	classifyWorkspaceFile,
	getWorkspaceBootstrapStatus,
} from "$lib/workspace-file-inventory";

const data = {
	publishTargets: [{ fileName: "aggregate.txt" }],
	clientExports: [{ fileName: "client.json" }],
} as Parameters<typeof classifyWorkspaceFile>[1];

describe("Workspace file inventory", () => {
	it("classifies reserved, managed, and external files", () => {
		expect(classifyWorkspaceFile("subman.json", data)).toBe("workspace-config");
		expect(classifyWorkspaceFile("subman.v1.backup.json", data)).toBe(
			"v1-migration-backup",
		);
		expect(classifyWorkspaceFile("subman.bootstrap.json", data)).toBe(
			"bootstrap-marker",
		);
		expect(classifyWorkspaceFile("aggregate.txt", data)).toBe("managed-output");
		expect(classifyWorkspaceFile("notes.txt", data)).toBe("external-file");
	});

	it("distinguishes incomplete initialization from a stale marker", () => {
		expect(getWorkspaceBootstrapStatus(["subman.bootstrap.json"])).toBe(
			"incomplete",
		);
		expect(
			getWorkspaceBootstrapStatus(["subman.json", "subman.bootstrap.json"]),
		).toBe("stale");
		expect(getWorkspaceBootstrapStatus(["subman.json"])).toBeNull();
		expect(
			getWorkspaceBootstrapStatus(["subman.bootstrap.json", "notes.txt"]),
		).toBe("invalid");
	});

	it("allows ordinary deletion only for non-reserved files", () => {
		expect(canDeleteWorkspaceFile("nodes.txt")).toBe(true);
		expect(canDeleteWorkspaceFile("subman.json")).toBe(false);
		expect(canDeleteWorkspaceFile("subman.v1.backup.json")).toBe(false);
		expect(canDeleteWorkspaceFile("subman.bootstrap.json")).toBe(false);
	});
});
