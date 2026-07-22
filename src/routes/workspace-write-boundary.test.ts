// @ts-nocheck
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "svelte/compiler";

type ImportNode = {
	type: "ImportDeclaration";
	source: { value: string };
	specifiers: Array<{
		type: string;
		imported?: { name?: string; value?: string };
	}>;
};

type ParsedComponent = {
	instance?: {
		content: {
			body: Array<{ type: string }>;
		};
	} | null;
};

const routesRoot = fileURLToPath(new URL(".", import.meta.url));

function pageFiles(): string[] {
	return (readdirSync(routesRoot, { recursive: true }) as string[])
		.filter((fileName) => fileName.endsWith("+page.svelte"))
		.map((fileName) => resolve(routesRoot, fileName));
}

function directGistMutators(fileName: string): string[] {
	const source = readFileSync(fileName, "utf8");
	const component = parse(source, { modern: true }) as ParsedComponent;
	const imports = (component.instance?.content.body ?? []).filter(
		(node): node is ImportNode => node.type === "ImportDeclaration",
	);
	return imports
		.filter((node) => node.source.value === "$lib/gist")
		.flatMap((node) =>
			node.specifiers.map(
				(specifier) =>
					specifier.imported?.name ?? specifier.imported?.value ?? "namespace",
			),
		)
		.filter((name) => name === "createGist" || name === "updateGist");
}

test("route pages cannot bypass the workspace write boundary", () => {
	const pages = pageFiles();
	const violations = pages.flatMap((fileName) =>
		directGistMutators(fileName).map(
			(mutator) => `${relative(routesRoot, fileName)} imports ${mutator}`,
		),
	);

	expect(pages.length).toBeGreaterThan(0);
	expect(violations).toEqual([]);
});
