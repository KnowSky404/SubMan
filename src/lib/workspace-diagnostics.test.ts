import { expect, test } from "bun:test";
import { createDefaultWorkspaceState } from "$lib/workspace-data";
import { exportWorkspaceDiagnostics } from "$lib/workspace-diagnostics";

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();
	get length(): number {
		return this.values.size;
	}
	clear(): void {
		this.values.clear();
	}
	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.values.delete(key);
	}
	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

test("diagnostics exclude quarantined contents and credentials", () => {
	const storage = new MemoryStorage();
	const token = "github_pat_must_not_escape";
	storage.setItem(
		"subman:workspace-state:v2:quarantine:one",
		JSON.stringify({ Authorization: `Bearer ${token}` }),
	);

	const diagnostics = exportWorkspaceDiagnostics(
		createDefaultWorkspaceState(),
		storage,
	);

	expect(diagnostics).not.toContain(token);
	expect(diagnostics).not.toContain("Authorization");
	expect(diagnostics).toContain('"quarantines"');
});
