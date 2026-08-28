// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

function interfaceMembers(source: ts.SourceFile, name: string): string[] {
	const members: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
			for (const member of node.members) {
				if (
					ts.isPropertySignature(member) &&
					member.name &&
					ts.isIdentifier(member.name)
				) {
					members.push(member.name.text);
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return members;
}

test("Cloudflare declaration matches the Wrangler Durable Object binding", () => {
	const wrangler = readFileSync(`${root}/wrangler.toml`, "utf8");
	const declarationText = readFileSync(
		`${root}/src/worker-configuration.d.ts`,
		"utf8",
	);
	const declaration = ts.createSourceFile(
		"worker-configuration.d.ts",
		declarationText,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);

	expect(wrangler).toContain('name = "WORKSPACE_COORDINATOR"');
	expect(wrangler).toContain('class_name = "WorkspaceCoordinator"');
	expect(wrangler).toContain('new_sqlite_classes = ["WorkspaceCoordinator"]');
	expect(interfaceMembers(declaration, "Env")).toContain(
		"WORKSPACE_COORDINATOR",
	);
	expect(declarationText).toContain(
		'import("./lib/server/workspace-coordinator").WorkspaceCoordinator',
	);
	expect(interfaceMembers(declaration, "Env")).toContain("ASSETS");
});
