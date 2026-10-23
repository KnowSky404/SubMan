import { afterEach, describe, expect, it } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	buildWiki,
	checkWiki,
	collectWikiPages,
	renderWikiPage,
	validateOutputDirectory,
	validateWikiPages,
	type WikiPage,
} from "./wiki";

const temporary: string[] = [];

afterEach(() => {
	for (const path of temporary.splice(0))
		rmSync(path, { recursive: true, force: true });
});

function directory(): string {
	const path = mkdtempSync(join(tmpdir(), "subman-wiki-test-"));
	temporary.push(path);
	return path;
}

function fixture(): string {
	const root = directory();
	for (const [path, content] of Object.entries({
		"docs/wiki/Home.md": "# Home\n[Chinese](Home.zh-CN.md)\n",
		"docs/wiki/Home.zh-CN.md": "# Home\n[English](Home.md)\n",
		"docs/wiki/_Sidebar.md": "[Home](Home.md)\n",
		"docs/api/server-api.md": "# API\n",
		"docs/api/server-api.zh-CN.md": "# API\n",
		"docs/README.md": "# Index\n",
		"docs/README.zh-CN.md": "# Index\n",
		"docs/archive/specs/old.md": "# Historical record\n",
		"docs/adr/old.md": "# Historical decision\n",
		"docs/assets/brand/prompt.md": "[Historical image prompt](missing.md)\n",
		"README.md": "# Repository\n",
		"DESIGN.md": "# Design\n",
		"docs/api/openapi.yaml": "openapi: 3.1.1\n",
		"static/image (final).png": "fixture",
	})) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	return root;
}

function render(root: string, content: string): string {
	const pages = collectWikiPages(root);
	const page = { source: "docs/wiki/Home.md", slug: "Home", content };
	return renderWikiPage(root, page, pages);
}

describe("Wiki documentation", () => {
	it("exports maintained bilingual docs, excludes historical records, and detects missing translations", () => {
		const root = fixture();
		const pages = checkWiki(root);
		expect(pages.map((page) => page.slug)).toEqual([
			"api-server-api",
			"api-server-api.zh-CN",
			"_Sidebar",
			"Home",
			"Home.zh-CN",
		]);
		expect(() =>
			validateWikiPages(
				pages.filter((page) => !page.source.endsWith("server-api.zh-CN.md")),
			),
		).toThrow("Missing language counterpart");
	});

	it("rejects flattened page name collisions", () => {
		const pages: WikiPage[] = [
			{ source: "docs/wiki/Home.md", slug: "Home", content: "" },
			{ source: "docs/wiki/Home.zh-CN.md", slug: "Home.zh-CN", content: "" },
			{ source: "docs/wiki/_Sidebar.md", slug: "_Sidebar", content: "" },
			{ source: "docs/Home.md", slug: "Home", content: "" },
		];
		expect(() => validateWikiPages(pages)).toThrow("Wiki page name collision");
	});

	it("rewrites Wiki and repository links while preserving fragments and titles", () => {
		const result = render(
			fixture(),
			'[API](../api/server-api.md#limits "API limits") [index](../README.zh-CN.md) [root](../../README.md) [design](/DESIGN.md) [schema](../api/openapi.yaml)',
		);
		expect(result).toBe(
			'[API](api-server-api#limits "API limits") [index](Home.zh-CN) [root](https://github.com/KnowSky404/SubMan/blob/main/README.md) [design](https://github.com/KnowSky404/SubMan/blob/main/DESIGN.md) [schema](https://github.com/KnowSky404/SubMan/blob/main/docs/api/openapi.yaml)',
		);
	});

	it("preserves remote URLs, inline code and fenced code examples", () => {
		const content =
			"[web](https://example.com/a_(b)) [fragment](#local)\n`[example](missing.md)`\n~~~md\n[example](also-missing.md)\n~~~\n[API](../api/server-api.md)";
		expect(render(fixture(), content)).toBe(
			content.replace("[API](../api/server-api.md)", "[API](api-server-api)"),
		);
	});

	it("rewrites reference links and image paths with spaces and parentheses", () => {
		const content =
			'[API][api]\n\n[api]: ../api/server-api.md#limits "API"\n![Logo](<../../static/image (final).png> "Logo")\n![Logo ref][picture]\n[picture]: <../../static/image (final).png>';
		expect(render(fixture(), content)).toBe(
			'[API][api]\n\n[api]: api-server-api#limits "API"\n![Logo](<https://raw.githubusercontent.com/KnowSky404/SubMan/main/static/image%20(final).png> "Logo")\n![Logo ref][picture]\n[picture]: <https://raw.githubusercontent.com/KnowSky404/SubMan/main/static/image%20(final).png>',
		);
	});

	it("fails on missing local files and links leaving the repository", () => {
		const root = fixture();
		expect(() => render(root, "[missing](../missing.md)")).toThrow(
			"Broken local link",
		);
		expect(() => render(root, "[outside](../../../outside.md)")).toThrow(
			"Link leaves repository",
		);
	});

	it("preserves angle brackets around external destinations containing spaces", () => {
		const content = '[external](<https://example.com/a b> "title")';
		expect(render(fixture(), content)).toBe(content);
	});

	it("checks links in README and historical records without requiring historical translations", () => {
		const root = fixture();
		writeFileSync(join(root, "README.md"), "[bad](missing.md)");
		expect(() => checkWiki(root)).toThrow("Broken local link in README.md");
		writeFileSync(join(root, "README.md"), "# Repository\n");
		writeFileSync(join(root, "docs/archive/specs/old.md"), "[bad](missing.md)");
		expect(() => checkWiki(root)).toThrow(
			"Broken local link in docs/archive/specs/old.md",
		);
	});

	it("rejects source and output symlinks and repository output directories", () => {
		const root = fixture();
		const outside = directory();
		symlinkSync(outside, join(root, "docs", "linked"));
		expect(() => collectWikiPages(root)).toThrow("Symlink in documentation");
		expect(() => validateOutputDirectory(root, root)).toThrow(
			"Wiki output must",
		);
		expect(() => validateOutputDirectory(root, join(root, "src"))).toThrow(
			"Wiki output must",
		);
		const output = join(directory(), "link");
		symlinkSync(outside, output);
		expect(() => validateOutputDirectory(root, output)).toThrow(
			"Wiki output must not follow symlinks",
		);
	});

	it("builds repeatably and removes only stale files previously owned by the generator", () => {
		const root = fixture();
		const output = join(directory(), "rendered");
		expect(buildWiki(root, output)).toBe(5);
		expect(readFileSync(join(output, "Home.md"), "utf8")).toContain(
			"[Chinese](Home.zh-CN)",
		);
		writeFileSync(join(output, "manual.md"), "keep");
		writeFileSync(join(root, "docs/wiki/Temporary.md"), "temporary");
		writeFileSync(join(root, "docs/wiki/Temporary.zh-CN.md"), "temporary");
		expect(buildWiki(root, output)).toBe(7);
		rmSync(join(root, "docs/wiki/Temporary.md"));
		rmSync(join(root, "docs/wiki/Temporary.zh-CN.md"));
		expect(buildWiki(root, output)).toBe(5);
		expect(readFileSync(join(output, "manual.md"), "utf8")).toBe("keep");
		expect(() => readFileSync(join(output, "Temporary.md"))).toThrow();
	});

	it("refuses to overwrite an unrelated nonempty directory", () => {
		const output = directory();
		writeFileSync(join(output, "manual.md"), "keep");
		expect(() => buildWiki(fixture(), output)).toThrow(
			"Wiki output is not empty",
		);
		expect(readFileSync(join(output, "manual.md"), "utf8")).toBe("keep");
	});
});
