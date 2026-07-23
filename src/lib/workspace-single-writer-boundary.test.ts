// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

function runtimeTypeScriptFiles(): string[] {
	return (readdirSync(sourceRoot, { recursive: true }) as string[])
		.filter(
			(fileName) =>
				fileName.endsWith(".ts") &&
				!fileName.endsWith(".test.ts") &&
				!fileName.endsWith(".d.ts"),
		)
		.map((fileName) => resolve(sourceRoot, fileName));
}

function displayPath(fileName: string): string {
	return relative(sourceRoot, fileName).replaceAll("\\", "/");
}

function importers(moduleName: string, exportName: string): string[] {
	return runtimeTypeScriptFiles()
		.filter((fileName) => {
			const source = ts.createSourceFile(
				fileName,
				readFileSync(fileName, "utf8"),
				ts.ScriptTarget.Latest,
				true,
			);
			return source.statements.some((statement) => {
				if (
					!ts.isImportDeclaration(statement) ||
					!ts.isStringLiteral(statement.moduleSpecifier) ||
					statement.moduleSpecifier.text !== moduleName
				) {
					return false;
				}
				const bindings = statement.importClause?.namedBindings;
				return (
					bindings !== undefined &&
					ts.isNamedImports(bindings) &&
					bindings.elements.some(
						(element) =>
							(element.propertyName?.text ?? element.name.text) === exportName,
					)
				);
			});
		})
		.map(displayPath)
		.sort();
}

function filesMatching(pattern: RegExp): string[] {
	return runtimeTypeScriptFiles()
		.filter((fileName) => pattern.test(readFileSync(fileName, "utf8")))
		.map(displayPath)
		.sort();
}

describe("Workspace single-writer boundary", () => {
	test("generic Gist mutations stay behind protected adapters", () => {
		expect(importers("$lib/gist", "createGist")).toEqual(["lib/workspace.ts"]);
		expect(importers("$lib/gist", "updateGist")).toEqual([]);

		const workspaceSource = readFileSync(
			resolve(sourceRoot, "lib/workspace.ts"),
			"utf8",
		);
		expect(workspaceSource).not.toContain("ensureWorkspaceGist");
		expect(workspaceSource).toContain("[WORKSPACE_BOOTSTRAP_FILE_NAME]");
	});

	test("only the coordinator can reach the Workspace Gist PATCH gateway", () => {
		expect(
			importers("$lib/server/workspace-gist", "createWorkspaceGistGateway"),
		).toEqual(["lib/server/workspace-coordinator.ts"]);
		expect(
			filesMatching(/\[WORKSPACE_FILE_NAME\]\s*:\s*\{\s*content:/),
		).toEqual(["lib/server/workspace-coordinator-core.ts"]);
	});
});
