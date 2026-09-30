// @ts-nocheck
import { expect, test } from "bun:test";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("Worker type generation is identical before and after a build", async () => {
	const fixture = mkdtempSync(join(tmpdir(), "subman-worker-types-"));
	const generatedPath = join(fixture, "src/worker-configuration.d.ts");
	const entrypoint = join(fixture, ".svelte-kit/cloudflare/_worker.js");
	try {
		mkdirSync(join(fixture, "scripts"), { recursive: true });
		mkdirSync(join(fixture, "src"));
		mkdirSync(join(fixture, ".svelte-kit/cloudflare"), { recursive: true });
		copyFileSync(join(root, "wrangler.toml"), join(fixture, "wrangler.toml"));
		copyFileSync(
			join(root, "scripts/generate-worker-types.sh"),
			join(fixture, "scripts/generate-worker-types.sh"),
		);
		symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"));

		const generate = async (...args: string[]) => {
			const process = Bun.spawn(
				["bash", "scripts/generate-worker-types.sh", ...args],
				{ cwd: fixture, stdout: "pipe", stderr: "pipe" },
			);
			const [exitCode, stdout, stderr] = await Promise.all([
				process.exited,
				new Response(process.stdout).text(),
				new Response(process.stderr).text(),
			]);
			expect({ exitCode, stdout, stderr }).toEqual({
				exitCode: 0,
				stdout: "",
				stderr: "",
			});
		};

		await generate();
		const cleanTypes = readFileSync(generatedPath, "utf8");
		writeFileSync(
			entrypoint,
			"export default { fetch() { return new Response('ok'); } };\nexport class WorkspaceCoordinator {}\n",
		);
		await generate();
		expect(readFileSync(generatedPath, "utf8")).toBe(cleanTypes);
		expect(cleanTypes).toBe(
			readFileSync(join(root, "src/worker-configuration.d.ts"), "utf8"),
		);
		await generate("--check");
		rmSync(entrypoint);
		await generate("--check");
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
}, 30_000);
