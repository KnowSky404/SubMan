import { get, writable } from "svelte/store";
import { browser } from "$app/environment";
import { t } from "$lib/i18n";
import type {
	AggregatePublishTarget,
	AggregateRule,
	AppState,
	ClientExportProfile,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";
import { showToast } from "$lib/stores/toast";
import { nowIso } from "$lib/utils/time";
import {
	enqueueAutomaticWorkspaceMutation,
	enqueueAutomaticWorkspaceReconcile,
	validateAutomaticWorkspaceMutationDraft,
	validateAutomaticWorkspaceReconcile,
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
): boolean {
	if (!browser) return true;
	const draft = { kind, payload };
	try {
		validateAutomaticWorkspaceMutationDraft(draft);
	} catch (error) {
		notifyRejectedWorkspaceMutation(error);
		return false;
	}
	void enqueueAutomaticWorkspaceMutation(draft).catch((error) => {
		notifyRejectedWorkspaceMutation(error);
	});
	return true;
}

function notifyRejectedWorkspaceMutation(error: unknown): void {
	showToast(
		get(t)("Workspace change was not saved: {error}", {
			error: error instanceof Error ? error.message : String(error),
		}),
		"error",
		6_000,
	);
}

export function upsertNode(node: NodeItem): boolean {
	if (
		!enqueueWorkspaceMutation("node.upsert", {
			operation: "replace",
			node,
		})
	) {
		return false;
	}
	appState.update((state) => {
		const index = state.nodes.findIndex((item) => item.id === node.id);
		if (index >= 0) {
			const nodes = [...state.nodes];
			nodes[index] = node;
			return { ...state, nodes, lastUpdated: nowIso() };
		}
		return { ...state, nodes: [node, ...state.nodes], lastUpdated: nowIso() };
	});
	return true;
}

export function removeNode(nodeId: string): boolean {
	if (!enqueueWorkspaceMutation("node.delete", { id: nodeId })) return false;
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
	return true;
}

export function upsertSubscription(subscription: SubscriptionItem): boolean {
	if (!enqueueWorkspaceMutation("subscription.upsert", { subscription })) {
		return false;
	}
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
	return true;
}

export function removeSubscription(subscriptionId: string): boolean {
	if (
		!enqueueWorkspaceMutation("subscription.delete", { id: subscriptionId })
	) {
		return false;
	}
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
	return true;
}

export function upsertAggregate(rule: AggregateRule): boolean {
	if (!enqueueWorkspaceMutation("aggregate.upsert", { aggregate: rule })) {
		return false;
	}
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
	return true;
}

export function removeAggregate(ruleId: string): boolean {
	if (!enqueueWorkspaceMutation("aggregate.delete", { id: ruleId }))
		return false;
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
	return true;
}

export function upsertPublishTarget(target: AggregatePublishTarget): boolean {
	if (!enqueueWorkspaceMutation("publish-target.upsert", { target })) {
		return false;
	}
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
	return true;
}

export function removePublishTarget(targetId: string): boolean {
	if (!enqueueWorkspaceMutation("publish-target.delete", { id: targetId })) {
		return false;
	}
	appState.update((state) => ({
		...state,
		publishTargets: state.publishTargets.filter((item) => item.id !== targetId),
		lastUpdated: nowIso(),
	}));
	return true;
}

export function upsertClientExport(profile: ClientExportProfile): boolean {
	if (!enqueueWorkspaceMutation("client-export.upsert", { profile })) {
		return false;
	}
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
	return true;
}

export function removeClientExport(profileId: string): boolean {
	if (!enqueueWorkspaceMutation("client-export.delete", { id: profileId })) {
		return false;
	}
	appState.update((state) => ({
		...state,
		clientExports: state.clientExports.filter((item) => item.id !== profileId),
		lastUpdated: nowIso(),
	}));
	return true;
}

export function replaceState(next: AppState): boolean {
	const state = { ...defaultState, ...next, lastUpdated: nowIso() };
	if (browser) {
		try {
			validateAutomaticWorkspaceReconcile(state);
		} catch (error) {
			notifyRejectedWorkspaceMutation(error);
			return false;
		}
		void enqueueAutomaticWorkspaceReconcile(state).catch((error) => {
			notifyRejectedWorkspaceMutation(error);
		});
	}
	appState.set(state);
	return true;
}
