import * as bunTest from "bun:test";
import { withWorkspaceLock } from "$lib/workspace-lock";

const { expect, test } = bunTest;
const { afterEach } = bunTest as unknown as {
	afterEach: (callback: () => void) => void;
};

const navigatorDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	"navigator",
);

function setNavigator(value: unknown): void {
	Object.defineProperty(globalThis, "navigator", {
		value,
		configurable: true,
	});
}

afterEach(() => {
	if (navigatorDescriptor) {
		Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
	} else {
		Reflect.deleteProperty(globalThis, "navigator");
	}
});

test("workspace lock uses the native Web Locks API when available", async () => {
	const requests: string[] = [];
	setNavigator({
		locks: {
			request: async <T>(name: string, callback: () => Promise<T>) => {
				requests.push(name);
				return callback();
			},
		},
	});

	const result = await withWorkspaceLock("workspace-write", async () => 42);

	expect(result).toBe(42);
	expect(requests).toEqual(["workspace-write"]);
});

test("workspace lock serializes callbacks with the in-memory fallback", async () => {
	setNavigator(undefined);
	const order: string[] = [];
	let releaseFirst!: () => void;
	const firstGate = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});

	const first = withWorkspaceLock("workspace-write", async () => {
		order.push("first-start");
		await firstGate;
		order.push("first-end");
	});
	const second = withWorkspaceLock("workspace-write", async () => {
		order.push("second-start");
	});

	await Promise.resolve();
	expect(order).toEqual(["first-start"]);
	releaseFirst();
	await Promise.all([first, second]);
	expect(order).toEqual(["first-start", "first-end", "second-start"]);
});
