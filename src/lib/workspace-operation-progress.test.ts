import { expect, test } from "bun:test";
import { get } from "svelte/store";
import {
	withWorkspaceOperation,
	workspaceOperationProgress,
} from "$lib/workspace-operation-progress";

test("foreground waiting spans nested save and publish steps", async () => {
	let release = () => {};
	const confirmation = new Promise<void>((resolve) => {
		release = resolve;
	});
	const steps: string[] = [];
	const result = withWorkspaceOperation(async () => {
		await withWorkspaceOperation(async () => {
			await confirmation;
			steps.push("saved");
		});
		expect(get(workspaceOperationProgress)).not.toBe(null);
		steps.push("published");
		return "remote-committed";
	});
	expect(get(workspaceOperationProgress)?.messageKey).toBe(
		"Waiting for cloud confirmation...",
	);
	expect(steps).toEqual([]);
	release();
	expect(await result).toBe("remote-committed");
	expect(steps).toEqual(["saved", "published"]);
	expect(get(workspaceOperationProgress)).toBeNull();
});

test("a failed foreground action releases its lock and preserves the error", async () => {
	const failure = new Error("fixture failure");
	const error = await withWorkspaceOperation(() => {
		throw failure;
	}).catch((error: unknown) => error);
	expect(error).toBe(failure);
	expect(get(workspaceOperationProgress)).toBeNull();
});

test("a settled action cannot clear another action's loading state", async () => {
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const first = withWorkspaceOperation(
		() => held,
		"Loading workspace files...",
	);
	await withWorkspaceOperation(() => "done");
	expect(get(workspaceOperationProgress)?.messageKey).toBe(
		"Loading workspace files...",
	);
	release();
	await first;
	expect(get(workspaceOperationProgress)).toBeNull();
});
