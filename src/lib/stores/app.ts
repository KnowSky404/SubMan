import { writable } from "svelte/store";
import { browser } from "$app/environment";
import type {
	AggregatePublishTarget,
	AggregateRule,
	AppState,
	ClientExportProfile,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";
import { nowIso } from "$lib/utils/time";
import {
	enqueueAutomaticWorkspaceMutation,
	enqueueAutomaticWorkspaceReconcile,
} from "$lib/workspace-browser-mutation";
import {
	createDefaultWorkspaceState,
	reconcileWorkspaceState,
} from "$lib/workspace-data";
import type { WorkspaceMutation } from "$lib/workspace-mutation";

const STORAGE_KEY = "subman:state:v1";

export const defaultState: AppState = createDefaultWorkspaceState(nowIso());

function loadInitialState(): AppState {
	if (!browser) {
		return defaultState;
	}

	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) {
		return defaultState;
	}

	try {
		const parsed = JSON.parse(raw) as AppState;
		return { ...defaultState, ...parsed };
	} catch {
		return defaultState;
	}
}

export const appState = writable<AppState>(loadInitialState());

if (browser) {
	appState.subscribe((value) => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	});
}

function enqueueWorkspaceMutation(
	kind: WorkspaceMutation["kind"],
	payload: unknown,
): void {
	if (!browser) return;
	void enqueueAutomaticWorkspaceMutation({
		kind,
		payload,
	}).catch(() => {
		// Corrupt local coordination state must not be overwritten implicitly.
	});
}

export function upsertNode(node: NodeItem): void {
	enqueueWorkspaceMutation("node.upsert", { operation: "replace", node });
	appState.update((state) => {
		const index = state.nodes.findIndex((item) => item.id === node.id);
		if (index >= 0) {
			const nodes = [...state.nodes];
			nodes[index] = node;
			return { ...state, nodes, lastUpdated: nowIso() };
		}
		return { ...state, nodes: [node, ...state.nodes], lastUpdated: nowIso() };
	});
}

export function removeNode(nodeId: string): void {
	enqueueWorkspaceMutation("node.delete", { id: nodeId });
	appState.update((state) => {
		const now = nowIso();
		return reconcileWorkspaceState(
			{
				...state,
				nodes: state.nodes.filter((node) => node.id !== nodeId),
				lastUpdated: now,
			},
			now,
		);
	});
}

export function upsertSubscription(subscription: SubscriptionItem): void {
	enqueueWorkspaceMutation("subscription.upsert", { subscription });
	appState.update((state) => {
		const index = state.subscriptions.findIndex(
			(item) => item.id === subscription.id,
		);
		if (index >= 0) {
			const subscriptions = [...state.subscriptions];
			subscriptions[index] = subscription;
			return { ...state, subscriptions, lastUpdated: nowIso() };
		}
		return {
			...state,
			subscriptions: [subscription, ...state.subscriptions],
			lastUpdated: nowIso(),
		};
	});
}

export function removeSubscription(subscriptionId: string): void {
	enqueueWorkspaceMutation("subscription.delete", { id: subscriptionId });
	appState.update((state) => {
		const now = nowIso();
		return reconcileWorkspaceState(
			{
				...state,
				subscriptions: state.subscriptions.filter(
					(item) => item.id !== subscriptionId,
				),
				lastUpdated: now,
			},
			now,
		);
	});
}

export function upsertAggregate(rule: AggregateRule): void {
	enqueueWorkspaceMutation("aggregate.upsert", { aggregate: rule });
	appState.update((state) => {
		const index = state.aggregates.findIndex((item) => item.id === rule.id);
		if (index >= 0) {
			const aggregates = [...state.aggregates];
			aggregates[index] = rule;
			return { ...state, aggregates, lastUpdated: nowIso() };
		}
		return {
			...state,
			aggregates: [rule, ...state.aggregates],
			lastUpdated: nowIso(),
		};
	});
}

export function removeAggregate(ruleId: string): void {
	enqueueWorkspaceMutation("aggregate.delete", { id: ruleId });
	appState.update((state) => ({
		...state,
		aggregates: state.aggregates.filter((item) => item.id !== ruleId),
		publishTargets: state.publishTargets.filter(
			(target) => target.ruleId !== ruleId,
		),
		clientExports: state.clientExports.filter(
			(profile) => profile.ruleId !== ruleId,
		),
		lastUpdated: nowIso(),
	}));
}

export function upsertPublishTarget(target: AggregatePublishTarget): void {
	enqueueWorkspaceMutation("publish-target.upsert", { target });
	appState.update((state) => {
		const index = state.publishTargets.findIndex(
			(item) => item.id === target.id,
		);
		if (index >= 0) {
			const publishTargets = [...state.publishTargets];
			publishTargets[index] = target;
			return { ...state, publishTargets, lastUpdated: nowIso() };
		}
		return {
			...state,
			publishTargets: [target, ...state.publishTargets],
			lastUpdated: nowIso(),
		};
	});
}

export function removePublishTarget(targetId: string): void {
	enqueueWorkspaceMutation("publish-target.delete", { id: targetId });
	appState.update((state) => ({
		...state,
		publishTargets: state.publishTargets.filter((item) => item.id !== targetId),
		lastUpdated: nowIso(),
	}));
}

export function upsertClientExport(profile: ClientExportProfile): void {
	enqueueWorkspaceMutation("client-export.upsert", { profile });
	appState.update((state) => {
		const index = state.clientExports.findIndex(
			(item) => item.id === profile.id,
		);
		if (index >= 0) {
			const clientExports = [...state.clientExports];
			clientExports[index] = profile;
			return { ...state, clientExports, lastUpdated: nowIso() };
		}
		return {
			...state,
			clientExports: [profile, ...state.clientExports],
			lastUpdated: nowIso(),
		};
	});
}

export function removeClientExport(profileId: string): void {
	enqueueWorkspaceMutation("client-export.delete", { id: profileId });
	appState.update((state) => ({
		...state,
		clientExports: state.clientExports.filter((item) => item.id !== profileId),
		lastUpdated: nowIso(),
	}));
}

export function replaceState(next: AppState): void {
	const state = { ...defaultState, ...next, lastUpdated: nowIso() };
	if (browser) {
		void enqueueAutomaticWorkspaceReconcile(state).catch(() => {
			// Corrupt local coordination state must not be overwritten implicitly.
		});
	}
	appState.set(state);
}
