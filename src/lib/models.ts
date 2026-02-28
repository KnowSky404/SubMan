export type ProxyType =
	| 'vless'
	| 'vmess'
	| 'trojan'
	| 'ss'
	| 'ssr'
	| 'hysteria2'
	| 'tuic'
	| 'other';

export type SourceType = 'single' | 'subscription';

export type NodeTag = {
	id: string;
	label: string;
};

export type NodeItem = {
	id: string;
	name: string;
	type: ProxyType;
	raw: string;
	tags: NodeTag[];
	enabled: boolean;
	updatedAt: string;
	source: SourceType;
};

export type SubscriptionItem = {
	id: string;
	name: string;
	url: string;
	enabled: boolean;
	tags: NodeTag[];
	updatedAt: string;
};

export type AggregateRule = {
	id: string;
	name: string;
	nodeIds: string[];
	subscriptionIds: string[];
	excludeTagIds: string[];
	renameMap: Record<string, string>;
	allowedTypes: ProxyType[];
	updatedAt: string;
};

export type AggregatePublishTarget = {
	id: string;
	name: string;
	ruleId: string;
	fileName: string;
	description: string;
	isPublic: boolean;
	lastPublishedAt: string | null;
	lastPublishedUrl: string | null;
	updatedAt: string;
};

export type GistFile = {
	filename: string;
	language: string | null;
	size: number;
	rawUrl?: string;
};

export type GistMeta = {
	id: string;
	description: string | null;
	files: GistFile[];
	updatedAt: string;
	url: string;
};

export type AppState = {
	nodes: NodeItem[];
	subscriptions: SubscriptionItem[];
	aggregates: AggregateRule[];
	publishTargets: AggregatePublishTarget[];
	gists: GistMeta[];
	activeGistId: string | null;
	activeGistFile: string;
	lastUpdated: string;
};

export type AuthState = {
	token: string | null;
	lastLoginAt: string | null;
};
