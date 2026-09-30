import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importState } from "../src/lib/serialization";
import { classifyWorkspaceCandidate } from "../src/lib/workspace";
import { classifyWorkspaceFile } from "../src/lib/workspace-file-inventory";
import {
	InMemoryWorkspacePersistence,
	LEGACY_APP_STATE_KEY,
	migrateLegacyWorkspacePersistence,
	validateWorkspacePersistenceSnapshot,
} from "../src/lib/workspace-persistence";
import { auditWorkspace, exportLegacyConfiguration } from "./audit-workspace";

const NOW = "2026-02-28T00:00:00.000Z";
const URL =
	"https://gist.githubusercontent.com/fixture/gist-1/raw/aggregate.txt";

// Shapes follow bb23bed and 74ed11f; all values are synthetic.
function legacyData() {
	return {
		nodes: [],
		subscriptions: [],
		aggregates: [
			{
				id: "rule-1",
				name: "Historical rule",
				nodeIds: [],
				subscriptionIds: [],
				excludeTagIds: [],
				renameMap: {},
				updatedAt: NOW,
			},
		],
		publishTargets: [
			{
				id: "target-1",
				name: "Historical target",
				ruleId: "rule-1",
				fileName: "aggregate.txt",
				description: "",
				isPublic: false,
				lastPublishedAt: NOW,
				lastPublishedUrl: URL,
				updatedAt: NOW,
			},
		],
		gists: [],
		activeGistId: "gist-1",
		activeGistFile: "subman.json",
		lastUpdated: NOW,
	};
}

function legacyRaw(data: unknown = legacyData()) {
	return JSON.stringify({ version: 1, exportedAt: NOW, data });
}

describe("historical Workspace migration audit", () => {
	it("preserves historical rules and publication metadata across configuration import", () => {
		const { summary } = auditWorkspace(legacyRaw());
		expect(summary).toEqual({
			schemaVersion: 1,
			counts: {
				nodes: 0,
				subscriptions: 0,
				aggregates: 1,
				publishTargets: 1,
				clientExports: 0,
				publishedTargets: 1,
			},
		});
		const imported = importState(exportLegacyConfiguration(legacyRaw()));
		expect(validateWorkspacePersistenceSnapshot(imported)).toEqual(imported);
		expect(imported.aggregates[0]?.id).toBe("rule-1");
		expect(imported.aggregates[0]?.allowedTypes).toEqual([]);
		expect(imported.publishTargets[0]).toMatchObject({
			id: "target-1",
			ruleId: "rule-1",
			fileName: "aggregate.txt",
			lastPublishedAt: NOW,
			lastPublishedUrl: URL,
			lastPublishTransitionOutcome: null,
		});
		expect(imported.activeGistId).toBeNull();
	});

	it("does not infer targets from pre-target output files", () => {
		const { publishTargets: _, ...data } = legacyData();
		const audit = auditWorkspace(legacyRaw(data));
		expect(audit.summary.counts.aggregates).toBe(1);
		expect(audit.summary.counts.publishTargets).toBe(0);
		expect(
			classifyWorkspaceFile("aggregate.txt", audit.parsed.document.data),
		).toBe("external-file");
	});

	it("quarantines an old browser snapshot even when its V1 Gist envelope is readable", async () => {
		expect(() => auditWorkspace(legacyRaw())).not.toThrow();
		expect(() => validateWorkspacePersistenceSnapshot(legacyData())).toThrow();
		const values = new Map([
			[LEGACY_APP_STATE_KEY, JSON.stringify(legacyData())],
		]);
		const persistence = new InMemoryWorkspacePersistence();
		await migrateLegacyWorkspacePersistence(
			persistence,
			{
				getItem: (key) => values.get(key) ?? null,
				removeItem: (key) => {
					values.delete(key);
				},
				get length() {
					return values.size;
				},
				key: (index) => [...values.keys()][index] ?? null,
			},
			{ now: () => NOW },
		);
		const stored = await persistence.read();
		expect(stored.snapshot).toBeNull();
		expect(stored.quarantines).toHaveLength(1);
		expect(stored.quarantines[0]?.reason).toBe("invalid-legacy-snapshot");
	});

	it("marks a bad reference invalid and refuses a historical custom Gist description", async () => {
		const gist = {
			id: "gist-1",
			description: "SubMan-Data",
			files: [{ filename: "subman.json", language: "JSON", size: 100 }],
			updatedAt: NOW,
			url: "https://gist.github.com/fixture/gist-1",
		};
		const data = legacyData();
		Object.assign(data.aggregates[0], { nodeIds: ["removed-node"] });
		let reads = 0;
		const api = {
			createGist: async () => {
				throw new Error("Unexpected create");
			},
			getGist: async () => gist,
			listGists: async () => [gist],
			getGistFileContent: async () => {
				reads += 1;
				return legacyRaw(data);
			},
		};
		expect(
			(await classifyWorkspaceCandidate("fixture-token", gist, { api })).kind,
		).toBe("invalid");
		expect(reads).toBe(1);
		expect(
			(
				await classifyWorkspaceCandidate(
					"fixture-token",
					{ ...gist, description: "SubMan aggregate" },
					{ api },
				)
			).kind,
		).toBe("invalid");
		expect(reads).toBe(1);
	});

	it.each([
		["missing node", { nodeIds: ["removed-node"] }],
		["noncanonical timestamp", { updatedAt: "2026-02-28T00:00:00Z" }],
		["unknown rule field", { oldOption: true }],
	])("rejects the whole V1 document for %s", (_, change) => {
		const data = legacyData();
		Object.assign(data.aggregates[0], change);
		expect(() => auditWorkspace(legacyRaw(data))).toThrow();
	});

	it("rejects orphan targets and unsafe historical output filenames", () => {
		const data = legacyData();
		data.publishTargets[0].ruleId = "removed-rule";
		expect(() => auditWorkspace(legacyRaw(data))).toThrow();
		data.publishTargets[0].ruleId = "rule-1";
		data.publishTargets[0].fileName = "nested/aggregate.txt";
		expect(() => auditWorkspace(legacyRaw(data))).toThrow();
	});

	it("audits V2 identity but refuses to strip its tombstones into an import", () => {
		const raw = JSON.stringify({
			version: 2,
			schemaVersion: 2,
			workspaceId: "gist:gist-1",
			revision: 0,
			updatedAt: NOW,
			lastMutationId: null,
			data: {
				nodes: [],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			},
			tombstones: {
				nodes: [],
				subscriptions: [],
				aggregates: [],
				publishTargets: [],
				clientExports: [],
			},
		});
		expect(auditWorkspace(raw, "gist-1").summary.schemaVersion).toBe(2);
		expect(() => auditWorkspace(raw, "gist-2")).toThrow();
		expect(() => exportLegacyConfiguration(raw)).toThrow("v1_export_required");
	});

	it("CLI keeps source bytes and existing files, and never prints document values", async () => {
		const dir = await mkdtemp(join(tmpdir(), "subman-migration-audit-"));
		try {
			const input = join(dir, "subman.json");
			const output = join(dir, "import.json");
			const source = legacyRaw();
			await writeFile(input, source);
			const run = async (...args: string[]) => {
				const child = Bun.spawn(
					[process.execPath, "run", "scripts/audit-workspace.ts", ...args],
					{
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				return {
					code: await child.exited,
					stdout: await new Response(child.stdout).text(),
					stderr: await new Response(child.stderr).text(),
				};
			};
			const audit = await run(input);
			expect(audit.code).toBe(0);
			expect(audit.stdout).not.toContain("Historical");
			expect(audit.stdout).not.toContain(URL);
			expect((await run(input, "--export-v1", output)).code).toBe(0);
			const exported = await readFile(output, "utf8");
			expect((await stat(output)).mode & 0o777).toBe(0o600);
			expect((await run(input, "--export-v1", output)).code).toBe(1);
			expect(await readFile(output, "utf8")).toBe(exported);
			expect((await run(input, "--export-v1", input)).code).toBe(1);
			expect(await readFile(input, "utf8")).toBe(source);
			await writeFile(
				input,
				legacyRaw({ ...legacyData(), "secret-canary": "credential-canary" }),
			);
			const rejected = await run(input);
			expect(rejected.code).toBe(1);
			expect(rejected.stderr).toBe(
				'{"ok":false,"code":"invalid_workspace_document"}\n',
			);
			expect(rejected.stdout).toBe("");
			expect((await run(input, "--unknown", "value")).code).toBe(2);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
