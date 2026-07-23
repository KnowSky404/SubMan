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
