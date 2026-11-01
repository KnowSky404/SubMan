import { derived, writable } from "svelte/store";

type ForegroundOperation = { id: symbol; messageKey: string };
const operations = writable<ForegroundOperation[]>([]);

export const workspaceOperationProgress = derived(
	operations,
	($operations) => $operations[0] ?? null,
);

export async function withWorkspaceOperation<T>(
	action: () => T | Promise<T>,
	messageKey = "Waiting for cloud confirmation...",
): Promise<T> {
	const operation = { id: Symbol(), messageKey };
	operations.update((current) => [...current, operation]);
	try {
		return await action();
	} finally {
		operations.update((current) =>
			current.filter((item) => item.id !== operation.id),
		);
	}
}
