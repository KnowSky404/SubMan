export type WorkerLogLevel = "info" | "warn" | "error";

export type SafeWorkerLogFields = {
	requestId?: string;
	operation?: string;
	workspaceHash?: string;
	mutationId?: string;
	mutationKind?: string;
	expectedRevision?: number;
	committedRevision?: number;
	latencyMs?: number;
	status?: number;
	disposition?: string;
	errorCode?: string;
	githubOperation?: string;
	githubStatus?: number | null;
	githubCategory?: string;
	githubRequestId?: string | null;
};

const MAX_TEXT_LENGTH = 160;

function safeText(value: string): string {
	return value
		.trim()
		.replace(/\p{Cc}/gu, "?")
		.slice(0, MAX_TEXT_LENGTH);
}

function addText(
	payload: Record<string, string | number | null>,
	key: string,
	value: string | null | undefined,
): void {
	if (value === undefined || value === null || value === "") return;
	payload[key] = safeText(value);
}

function addNumber(
	payload: Record<string, string | number | null>,
	key: string,
	value: number | null | undefined,
): void {
	if (value === undefined || value === null || !Number.isFinite(value)) {
		return;
	}
	payload[key] = value;
}

export function logWorkerEvent(
	level: WorkerLogLevel,
	event: string,
	fields: SafeWorkerLogFields = {},
): void {
	const payload: Record<string, string | number | null> = {
		source: "subman",
		event: safeText(event),
	};
	addText(payload, "requestId", fields.requestId);
	addText(payload, "operation", fields.operation);
	addText(payload, "workspaceHash", fields.workspaceHash);
	addText(payload, "mutationId", fields.mutationId);
	addText(payload, "mutationKind", fields.mutationKind);
	addNumber(payload, "expectedRevision", fields.expectedRevision);
	addNumber(payload, "committedRevision", fields.committedRevision);
	addNumber(payload, "latencyMs", fields.latencyMs);
	addNumber(payload, "status", fields.status);
	addText(payload, "disposition", fields.disposition);
	addText(payload, "errorCode", fields.errorCode);
	addText(payload, "githubOperation", fields.githubOperation);
	addNumber(payload, "githubStatus", fields.githubStatus);
	addText(payload, "githubCategory", fields.githubCategory);
	addText(payload, "githubRequestId", fields.githubRequestId);

	const line = JSON.stringify(payload);
	if (level === "error") {
		console.error(line);
	} else if (level === "warn") {
		console.warn(line);
	} else {
		console.log(line);
	}
}

export async function hashWorkspaceId(
	workspaceId: string,
): Promise<string | null> {
	try {
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(workspaceId),
		);
		return Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		)
			.join("")
			.slice(0, 16);
	} catch {
		return null;
	}
}
