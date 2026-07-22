// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WRITE_ROUTES = [
	"api/nodes/+server.ts",
	"api/nodes/[id]/+server.ts",
	"api/nodes/by-key/[externalKey]/+server.ts",
];

describe("Server API workspace write boundary", () => {
	it("routes every node write through the Workspace coordinator", async () => {
		for (const route of WRITE_ROUTES) {
			const source = await readFile(
				fileURLToPath(new URL(route, import.meta.url)),
				"utf8",
			);
			expect(source).toContain("submitServerWorkspaceMutation");
			expect(source).not.toContain("transactServerWorkspace");
			expect(source).not.toContain("runWorkspaceTransaction");
			expect(source).not.toContain("updateGist(");
		}
	});
});
