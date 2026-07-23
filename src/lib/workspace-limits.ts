import type { WorkspaceDocumentV2 } from "$lib/workspace-document";

export const WORKSPACE_LIMITS = {
	mutationRequestBytes: 9 * 1024 * 1024,
	outputContentBytes: 1024 * 1024,
	nodeRawBytes: 16 * 1024,
	subscriptionUrlBytes: 8 * 1024,
	nameBytes: 256,
	labelBytes: 128,
	externalKeyBytes: 256,
	tagsPerEntity: 64,
	entitiesPerCollection: 5_000,
	renameMapEntries: 1_000,
	renameMapBytes: 64 * 1024,
	tombstoneWarningPerCollection: 10_000,
	workspaceDocumentBytes: 8 * 1024 * 1024,
} as const;

export function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function getWorkspaceTombstoneWarnings(
	document: WorkspaceDocumentV2,
): Partial<Record<keyof WorkspaceDocumentV2["tombstones"], number>> {
	const warnings: Partial<
		Record<keyof WorkspaceDocumentV2["tombstones"], number>
	> = {};
	for (const collection of Object.keys(document.tombstones) as Array<
		keyof WorkspaceDocumentV2["tombstones"]
	>) {
		const count = document.tombstones[collection].length;
		if (count > WORKSPACE_LIMITS.tombstoneWarningPerCollection) {
			warnings[collection] = count;
		}
	}
	return warnings;
}
