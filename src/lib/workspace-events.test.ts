import * as bunTest from "bun:test";
import {
	broadcastWorkspaceEvent,
	subscribeWorkspaceEvents,
	type WorkspaceEvent,
} from "$lib/workspace-events";

const { expect, test } = bunTest;
const { afterEach } = bunTest as unknown as {
	afterEach: (callback: () => void) => void;
};

const broadcastChannelDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	"BroadcastChannel",
);
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

function setGlobal(name: "BroadcastChannel" | "window", value: unknown): void {
	Object.defineProperty(globalThis, name, { value, configurable: true });
}

afterEach(() => {
	if (broadcastChannelDescriptor) {
		Object.defineProperty(
			globalThis,
			"BroadcastChannel",
			broadcastChannelDescriptor,
		);
	} else {
		Reflect.deleteProperty(globalThis, "BroadcastChannel");
	}
	if (windowDescriptor) {
		Object.defineProperty(globalThis, "window", windowDescriptor);
	} else {
		Reflect.deleteProperty(globalThis, "window");
	}
});

test("workspace events use BroadcastChannel when available", () => {
	class TestBroadcastChannel {
		static instances: TestBroadcastChannel[] = [];
		posted: WorkspaceEvent[] = [];
		closed = false;
		listener: ((event: { data: WorkspaceEvent }) => void) | null = null;

		constructor(readonly name: string) {
			TestBroadcastChannel.instances.push(this);
		}

		addEventListener(
			type: string,
			listener: (event: { data: WorkspaceEvent }) => void,
		): void {
			if (type === "message") this.listener = listener;
		}

		postMessage(event: WorkspaceEvent): void {
			this.posted.push(event);
		}

		close(): void {
			this.closed = true;
		}
	}

	setGlobal("window", undefined);
	setGlobal("BroadcastChannel", TestBroadcastChannel);
	const received: WorkspaceEvent[] = [];
	const stop = subscribeWorkspaceEvents((event) => received.push(event));
	const event: WorkspaceEvent = {
		type: "reset",
		gistId: null,
		fileName: null,
	};

	broadcastWorkspaceEvent(event);
	const subscription = TestBroadcastChannel.instances[0];
	const publication = TestBroadcastChannel.instances[1];
	publication?.listener?.({ data: event });
	for (const posted of publication?.posted ?? []) {
		subscription?.listener?.({ data: posted });
	}
	stop();

	expect(subscription?.name).toBe("subman:workspace:v1");
	expect(publication?.posted).toEqual([event]);
	expect(publication?.closed).toBe(true);
	expect(received).toEqual([event]);
	expect(subscription?.closed).toBe(true);
});

test("workspace events fall back to same-page custom events", () => {
	setGlobal("BroadcastChannel", undefined);
	setGlobal("window", new EventTarget());
	const received: WorkspaceEvent[] = [];
	const stop = subscribeWorkspaceEvents((event) => received.push(event));
	const event: WorkspaceEvent = {
		type: "paused-conflict",
		gistId: null,
		fileName: null,
	};

	broadcastWorkspaceEvent(event);
	stop();

	expect(received).toEqual([event]);
});
