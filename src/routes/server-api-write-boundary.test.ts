// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const WRITE_ROUTES = [
	"api/nodes/+server.ts",
	"api/nodes/[id]/+server.ts",
	"api/nodes/by-key/[externalKey]/+server.ts",
];

describe("Server API workspace write boundary", () => {
	it("routes every node write through the Workspace coordinator", () => {
		for (const route of WRITE_ROUTES) {
			const fileName = fileURLToPath(new URL(route, import.meta.url));
			const source = ts.createSourceFile(
				fileName,
				readFileSync(fileName, "utf8"),
				ts.ScriptTarget.Latest,
				true,
			);
			const workspaceImports = source.statements
				.filter(ts.isImportDeclaration)
				.filter(
					(statement) =>
						ts.isStringLiteral(statement.moduleSpecifier) &&
						statement.moduleSpecifier.text === "$lib/server/api/workspace",
				)
				.flatMap((statement) => {
					const bindings = statement.importClause?.namedBindings;
					return bindings && ts.isNamedImports(bindings)
						? bindings.elements.map(
								(element) => element.propertyName?.text ?? element.name.text,
							)
						: [];
				});
			const calls: string[] = [];
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
					calls.push(node.expression.text);
				}
				ts.forEachChild(node, visit);
			};
			visit(source);

			expect(workspaceImports).toContain("submitServerWorkspaceMutation");
			expect(calls).toContain("submitServerWorkspaceMutation");
			for (const legacyWriter of [
				"saveWorkspaceState",
				"transactServerWorkspace",
				"runWorkspaceTransaction",
				"updateGist",
			]) {
				expect(workspaceImports).not.toContain(legacyWriter);
				expect(calls).not.toContain(legacyWriter);
			}
		}
	});
});
