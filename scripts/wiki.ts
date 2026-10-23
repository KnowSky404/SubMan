import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const REPOSITORY_URL = "https://github.com/KnowSky404/SubMan";
const MANIFEST = ".subman-wiki-pages.json";
const EXCLUDED_DIRECTORIES = new Set(["archive", "adr", "assets"]);

export interface WikiPage {
	source: string;
	slug: string;
	content: string;
}

function slash(path: string): string {
	return path.split(sep).join("/");
}

function inside(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return (
		path === "" ||
		(!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
	);
}

function pageSlug(source: string): string {
	return source.startsWith("docs/wiki/")
		? source.slice("docs/wiki/".length, -3)
		: source.slice("docs/".length, -3).replaceAll("/", "-");
}

export function collectWikiPages(root: string): WikiPage[] {
	const pages: WikiPage[] = [];
	function visit(directory: string): void {
		for (const entry of readdirSync(join(root, directory), {
			withFileTypes: true,
		})) {
			if (entry.isSymbolicLink())
				throw new Error(`Symlink in documentation: ${directory}/${entry.name}`);
			const source = `${directory}/${entry.name}`;
			if (entry.isDirectory()) {
				if (directory === "docs" && EXCLUDED_DIRECTORIES.has(entry.name))
					continue;
				visit(source);
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				if (/^docs\/README(?:\.zh-CN)?\.md$/.test(source)) continue;
				pages.push({
					source,
					slug: pageSlug(source),
					content: readFileSync(join(root, source), "utf8"),
				});
			}
		}
	}
	visit("docs");
	return pages.sort((a, b) => a.source.localeCompare(b.source, "en"));
}

export function validateWikiPages(pages: readonly WikiPage[]): void {
	const sources = new Set(pages.map((page) => page.source));
	const slugs = new Set<string>();
	for (const page of pages) {
		if (!/^[\w.-]+$/.test(page.slug))
			throw new Error(`Unsupported Wiki page name: ${page.slug}`);
		const key = page.slug.toLowerCase();
		if (slugs.has(key))
			throw new Error(`Wiki page name collision: ${page.slug}`);
		slugs.add(key);
		if (page.slug === "_Sidebar") continue;
		const counterpart = page.source.endsWith(".zh-CN.md")
			? page.source.replace(/\.zh-CN\.md$/, ".md")
			: page.source.replace(/\.md$/, ".zh-CN.md");
		if (!sources.has(counterpart))
			throw new Error(`Missing language counterpart: ${counterpart}`);
	}
	for (const slug of ["Home", "Home.zh-CN", "_Sidebar"]) {
		if (!slugs.has(slug.toLowerCase()))
			throw new Error(`Missing Wiki entry page: ${slug}`);
	}
}

function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

function destinationRewriter(
	root: string,
	source: string,
	pages: readonly WikiPage[],
) {
	const slugs = new Map(pages.map((page) => [page.source, page.slug]));
	slugs.set("docs/README.md", "Home");
	slugs.set("docs/README.zh-CN.md", "Home.zh-CN");
	return (destination: string, image: boolean): string => {
		if (
			!destination ||
			/^[a-z][a-z\d+.-]*:/i.test(destination) ||
			destination.startsWith("//") ||
			destination.startsWith("#") ||
			destination.startsWith("?")
		)
			return destination;
		const match = /^([^?#]*)(.*)$/.exec(destination);
		if (!match) throw new Error(`Invalid link in ${source}`);
		const path = decodeURIComponent(match[1]);
		const absolute = path.startsWith("/")
			? resolve(root, `.${path}`)
			: resolve(root, dirname(source), path);
		if (!inside(root, absolute))
			throw new Error(`Link leaves repository in ${source}: ${destination}`);
		if (!existsSync(absolute))
			throw new Error(`Broken local link in ${source}: ${destination}`);
		if (!inside(realpathSync(root), realpathSync(absolute)))
			throw new Error(
				`Link follows a symlink outside repository in ${source}: ${destination}`,
			);
		const target = slash(relative(root, absolute));
		const slug = slugs.get(target);
		if (slug && !image) return `${slug}${match[2]}`;
		const base = image
			? "https://raw.githubusercontent.com/KnowSky404/SubMan/main"
			: `${REPOSITORY_URL}/blob/main`;
		return `${base}/${encodePath(target)}${match[2]}`;
	};
}

// Handle destinations separately so labels, optional titles and image syntax survive.
function rewriteDestination(
	text: string,
	rewrite: (value: string, image: boolean) => string,
	image: boolean,
): string {
	const match = /^(\s*)(?:<([^>]+)>|([^\s]+))([\s\S]*)$/.exec(text);
	if (!match) return text;
	const destination = rewrite(match[2] ?? match[3], image);
	return `${match[1]}${match[2] === undefined ? destination : `<${destination}>`}${match[4]}`;
}

export function renderWikiPage(
	root: string,
	page: WikiPage,
	pages: readonly WikiPage[],
): string {
	const rewrite = destinationRewriter(root, page.source, pages);
	const imageReferences = new Set(
		[...page.content.matchAll(/!\[([^\]]*)\](?:\[([^\]]*)\])?/g)].map((match) =>
			(match[2] || match[1]).trim().toLowerCase(),
		),
	);
	let fence: { marker: string; length: number } | undefined;
	let inlineTicks = 0;
	return page.content
		.split("\n")
		.map((line) => {
			const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
			if (marker) {
				if (!fence) fence = { marker: marker[0], length: marker.length };
				else if (
					marker[0] === fence.marker &&
					marker.length >= fence.length &&
					/^ {0,3}(`+|~+)\s*$/.test(line)
				)
					fence = undefined;
				return line;
			}
			if (fence) return line;
			const reference = /^( {0,3}\[([^\]]+)\]:)(.*)$/.exec(line);
			if (reference && !inlineTicks)
				return (
					reference[1] +
					rewriteDestination(
						reference[3],
						rewrite,
						imageReferences.has(reference[2].trim().toLowerCase()),
					)
				);
			let result = "";
			for (let index = 0; index < line.length; index++) {
				if (line[index] === "`" && line[index - 1] !== "\\") {
					let end = index + 1;
					while (line[end] === "`") end++;
					const length = end - index;
					if (!inlineTicks) inlineTicks = length;
					else if (inlineTicks === length) inlineTicks = 0;
					result += line.slice(index, end);
					index = end - 1;
					continue;
				}
				if (
					!inlineTicks &&
					line[index] === "]" &&
					line[index + 1] === "(" &&
					line[index - 1] !== "\\"
				) {
					let end = index + 2;
					let depth = 1;
					let angle = false;
					let quote = "";
					for (; end < line.length; end++) {
						const char = line[end];
						if (char === "\\") {
							end++;
							continue;
						}
						if (quote) {
							if (char === quote) quote = "";
							continue;
						}
						if ((char === '"' || char === "'") && /\s/.test(line[end - 1])) {
							quote = char;
							continue;
						}
						if (char === "<") angle = true;
						if (char === ">") angle = false;
						if (!angle && char === "(") depth++;
						if (!angle && char === ")" && --depth === 0) break;
					}
					if (depth === 0) {
						const image = /!\[[^\]]*$/.test(line.slice(0, index));
						result += `](${rewriteDestination(line.slice(index + 2, end), rewrite, image)})`;
						index = end;
						continue;
					}
				}
				result += line[index];
			}
			return result;
		})
		.join("\n");
}

export function checkWiki(root: string): WikiPage[] {
	const pages = collectWikiPages(root);
	validateWikiPages(pages);
	for (const page of pages) renderWikiPage(root, page, pages);
	const checked = new Set(pages.map((page) => page.source));
	function checkOtherLinks(directory: string): void {
		for (const entry of readdirSync(join(root, directory), {
			withFileTypes: true,
		})) {
			const source = directory ? `${directory}/${entry.name}` : entry.name;
			if (!directory && entry.name !== "docs" && !entry.name.endsWith(".md"))
				continue;
			if (source === "docs/assets") continue;
			if (entry.isSymbolicLink())
				throw new Error(`Symlink in documentation: ${source}`);
			if (entry.isDirectory() && (directory || entry.name === "docs"))
				checkOtherLinks(source);
			else if (
				entry.isFile() &&
				entry.name.endsWith(".md") &&
				!checked.has(source)
			) {
				renderWikiPage(
					root,
					{
						source,
						slug: "",
						content: readFileSync(join(root, source), "utf8"),
					},
					pages,
				);
			}
		}
	}
	checkOtherLinks("");
	return pages;
}

export function validateOutputDirectory(root: string, output: string): string {
	const absolute = resolve(output);
	const generated = resolve(root, ".wrangler/wiki");
	const temporary = resolve(tmpdir());
	if (
		absolute !== generated &&
		!(
			inside(temporary, absolute) &&
			absolute !== temporary &&
			!inside(absolute, root) &&
			!inside(root, absolute)
		)
	) {
		throw new Error(
			"Wiki output must be .wrangler/wiki or a dedicated temporary directory",
		);
	}
	let ancestor = absolute;
	while (!existsSync(ancestor)) ancestor = dirname(ancestor);
	if (realpathSync(ancestor) !== ancestor)
		throw new Error("Wiki output must not follow symlinks");
	if (
		existsSync(absolute) &&
		(!lstatSync(absolute).isDirectory() || lstatSync(absolute).isSymbolicLink())
	)
		throw new Error("Wiki output must be a directory");
	return absolute;
}

export function buildWiki(root: string, output: string): number {
	const pages = checkWiki(root);
	const destination = validateOutputDirectory(root, output);
	const manifestPath = join(destination, MANIFEST);
	let previous: string[] = [];
	if (lstatSync(manifestPath, { throwIfNoEntry: false })?.isSymbolicLink())
		throw new Error("Generated Wiki manifest must not be a symlink");
	if (existsSync(manifestPath)) {
		const value: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (
			!Array.isArray(value) ||
			!value.every(
				(file) => typeof file === "string" && /^[\w.-]+\.md$/.test(file),
			)
		)
			throw new Error("Invalid generated Wiki manifest");
		previous = value;
	} else if (existsSync(destination) && readdirSync(destination).length) {
		throw new Error(
			"Wiki output is not empty and has no generated-page manifest",
		);
	}
	const rendered = pages.map((page) => ({
		file: `${page.slug}.md`,
		content: renderWikiPage(root, page, pages),
	}));
	mkdirSync(destination, { recursive: true });
	for (const page of rendered) {
		const path = join(destination, page.file);
		if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
			throw new Error("Generated Wiki page must not be a symlink");
		writeFileSync(path, page.content);
	}
	const current = new Set(rendered.map((page) => page.file));
	for (const file of previous)
		if (!current.has(file)) rmSync(join(destination, file), { force: true });
	writeFileSync(manifestPath, `${JSON.stringify([...current], null, 2)}\n`);
	return pages.length;
}

if (import.meta.main) {
	try {
		const root = resolve(import.meta.dir, "..");
		const args = process.argv.slice(2);
		const command = args.shift() ?? "check";
		if (command === "check" && !args.length) {
			console.log(
				`Wiki documentation valid: ${checkWiki(root).length} pages, paired languages and local links checked.`,
			);
		} else if (
			command === "build" &&
			(!args.length || (args.length === 2 && args[0] === "--out-dir"))
		) {
			const output = resolve(args[1] ?? join(root, ".wrangler/wiki"));
			console.log(
				`Built ${buildWiki(root, output)} Wiki pages in ${output}. No remote changes made.`,
			);
		} else
			throw new Error(
				"Usage: bun run scripts/wiki.ts [check | build [--out-dir DIRECTORY]]",
			);
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "Wiki generation failed",
		);
		process.exitCode = 1;
	}
}
