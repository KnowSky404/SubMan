import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import type {
	AppState,
	AggregatePublishTarget,
	AggregateRule,
	NodeItem,
	SubscriptionItem
} from '$lib/models';
import { nowIso } from '$lib/utils/time';

const STORAGE_KEY = 'subman:state:v1';

export const defaultState: AppState = {
	nodes: [],
	subscriptions: [],
	aggregates: [],
	publishTargets: [],
	gists: [],
	activeGistId: null,
	activeGistFile: 'subman.json',
	lastUpdated: nowIso()
};

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
		const next = { ...value, lastUpdated: nowIso() };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	});
}

export function upsertNode(node: NodeItem): void {
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
	appState.update((state) => ({
		...state,
		nodes: state.nodes.filter((node) => node.id !== nodeId),
		lastUpdated: nowIso()
	}));
}

export function upsertSubscription(subscription: SubscriptionItem): void {
	appState.update((state) => {
		const index = state.subscriptions.findIndex((item) => item.id === subscription.id);
		if (index >= 0) {
			const subscriptions = [...state.subscriptions];
			subscriptions[index] = subscription;
			return { ...state, subscriptions, lastUpdated: nowIso() };
		}
		return { ...state, subscriptions: [subscription, ...state.subscriptions], lastUpdated: nowIso() };
	});
}

export function removeSubscription(subscriptionId: string): void {
	appState.update((state) => ({
		...state,
		subscriptions: state.subscriptions.filter((item) => item.id !== subscriptionId),
		lastUpdated: nowIso()
	}));
}

export function upsertAggregate(rule: AggregateRule): void {
	appState.update((state) => {
		const index = state.aggregates.findIndex((item) => item.id === rule.id);
		if (index >= 0) {
			const aggregates = [...state.aggregates];
			aggregates[index] = rule;
			return { ...state, aggregates, lastUpdated: nowIso() };
		}
		return { ...state, aggregates: [rule, ...state.aggregates], lastUpdated: nowIso() };
	});
}

export function removeAggregate(ruleId: string): void {
	appState.update((state) => ({
		...state,
		aggregates: state.aggregates.filter((item) => item.id !== ruleId),
		publishTargets: state.publishTargets.filter((target) => target.ruleId !== ruleId),
		lastUpdated: nowIso()
	}));
}

export function upsertPublishTarget(target: AggregatePublishTarget): void {
	appState.update((state) => {
		const index = state.publishTargets.findIndex((item) => item.id === target.id);
		if (index >= 0) {
			const publishTargets = [...state.publishTargets];
			publishTargets[index] = target;
			return { ...state, publishTargets, lastUpdated: nowIso() };
		}
		return { ...state, publishTargets: [target, ...state.publishTargets], lastUpdated: nowIso() };
	});
}

export function removePublishTarget(targetId: string): void {
	appState.update((state) => ({
		...state,
		publishTargets: state.publishTargets.filter((item) => item.id !== targetId),
		lastUpdated: nowIso()
	}));
}

export function replaceState(next: AppState): void {
	appState.set({ ...defaultState, ...next, lastUpdated: nowIso() });
}
