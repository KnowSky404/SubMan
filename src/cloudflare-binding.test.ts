// @ts-nocheck
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

function interfaceMembers(source: ts.SourceFile, name: string): string[] {
	const declarations = new Map<string, ts.InterfaceDeclaration[]>();
	const visit = (node: ts.Node): void => {
		if (ts.isInterfaceDeclaration(node)) {
			const existing = declarations.get(node.name.text) ?? [];
			existing.push(node);
			declarations.set(node.name.text, existing);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);

	const resolve = (interfaceName: string, seen: Set<string>): Set<string> => {
		if (seen.has(interfaceName)) return new Set();
		const nextSeen = new Set(seen).add(interfaceName);
		const members = new Set<string>();

		for (const declaration of declarations.get(interfaceName) ?? []) {
			for (const member of declaration.members) {
				if (
					ts.isPropertySignature(member) &&
					member.name &&
					ts.isIdentifier(member.name)
				) {
					members.add(member.name.text);
				}
			}

			for (const clause of declaration.heritageClauses ?? []) {
				if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
				for (const inherited of clause.types) {
					if (!ts.isIdentifier(inherited.expression)) continue;
					for (const member of resolve(inherited.expression.text, nextSeen)) {
						members.add(member);
					}
				}
			}
		}

		return members;
	};

	return [...resolve(name, new Set())];
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
