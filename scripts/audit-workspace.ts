import { writeFile } from "node:fs/promises";
import {
	migrateWorkspaceDocumentV1ToV2,
	parseWorkspaceDocument,
	WorkspaceDocumentError,
} from "../src/lib/workspace-document";

export function auditWorkspace(raw: string, gistId?: string) {
	const parsed = parseWorkspaceDocument(raw, {
		expectedWorkspaceId: gistId ? `gist:${gistId}` : undefined,
	});
	const data = parsed.document.data;
	return {
		parsed,
		summary: {
			schemaVersion: parsed.schemaVersion,
			counts: {
				nodes: data.nodes.length,
				subscriptions: data.subscriptions.length,
				aggregates: data.aggregates.length,
				publishTargets: data.publishTargets.length,
				clientExports: data.clientExports.length,
				publishedTargets: data.publishTargets.filter(
					(target) => target.lastPublishedAt !== null,
				).length,
			},
		},
	};
}

export function exportLegacyConfiguration(raw: string): string {
	const { parsed } = auditWorkspace(raw);
	if (parsed.schemaVersion !== 1) {
		throw new Error("v1_export_required");
	}
	const { document } = migrateWorkspaceDocumentV1ToV2(parsed.document, {
		gistId: "offline",
	});
	return JSON.stringify(
		{
			version: 2,
			kind: "subman-business-configuration",
			exportedAt: new Date().toISOString(),
			data: document.data,
		},
		null,
		2,
	);
}

export async function runWorkspaceAudit(args: string[]): Promise<number> {
	const [input, ...flags] = args;
	let gistId: string | undefined;
	let output: string | undefined;
	for (let index = 0; index < flags.length; index += 2) {
		const flag = flags[index];
		const value = flags[index + 1];
		if (!value || value.startsWith("--")) return usage();
		if (flag === "--gist-id" && gistId === undefined) gistId = value;
		else if (flag === "--export-v1" && output === undefined) output = value;
		else return usage();
	}
	if (!input || input.startsWith("--")) return usage();
	try {
		const raw = await Bun.file(input).text();
		const { summary } = auditWorkspace(raw, gistId);
		if (output) {
			// Exclusive creation preserves both the source and existing exports.
			await writeFile(output, exportLegacyConfiguration(raw), {
				flag: "wx",
				mode: 0o600,
			});
		}
		console.log(JSON.stringify({ ...summary, exported: Boolean(output) }));
		return 0;
	} catch (error) {
		// Parser messages may contain user-controlled IDs or field names.
		const code =
			error instanceof WorkspaceDocumentError
				? error.code
				: error instanceof Error && error.message === "v1_export_required"
					? "v1_export_required"
					: "local_file_operation_failed";
		console.error(JSON.stringify({ ok: false, code }));
		return 1;
	}
}

function usage(): number {
	console.error(
		"Usage: bun run scripts/audit-workspace.ts <subman.json> [--gist-id <id>] [--export-v1 <new-file.json>]",
	);
	return 2;
}

if (import.meta.main)
	process.exitCode = await runWorkspaceAudit(Bun.argv.slice(2));
