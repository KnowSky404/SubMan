import * as bunTest from "bun:test";
import type { GistMeta } from "$lib/models";
import {
	deleteWorkspaceOutputFile,
	ProtectedWorkspaceFileError,
} from "$lib/workspace-output-files";

type MockedFunction<T extends (...args: never[]) => unknown> = T & {
	mock: { calls: unknown[][] };
};

const { expect, test } = bunTest;
const { mock } = bunTest as unknown as {
	mock: <T extends (...args: never[]) => unknown>(
		callback: T,
	) => MockedFunction<T>;
};

function gist(): GistMeta {
	return {
		id: "gist-1",
		description: "SubMan-Data",
		files: [{ filename: "subman.json", language: "JSON", size: 1 }],
		updatedAt: "2026-07-22T00:00:00.000Z",
		url: "https://gist.github.com/gist-1",
	};
}

test("workspace config cannot be deleted through the output boundary", async () => {
	const update = mock(async () => gist());
	let error: unknown;

	try {
		await deleteWorkspaceOutputFile("token", "gist-1", "subman.json", update);
	} catch (caught) {
		error = caught;
	}

	expect(error instanceof ProtectedWorkspaceFileError).toBe(true);
	expect(update.mock.calls).toHaveLength(0);
});

test("workspace output deletion sends one file-scoped PATCH", async () => {
	const update = mock(async () => gist());

	await deleteWorkspaceOutputFile("token", "gist-1", "aggregate.txt", update);

	expect(update.mock.calls).toEqual([
		[
			"token",
			{
				gistId: "gist-1",
				files: { "aggregate.txt": null },
			},
		],
	]);
});
