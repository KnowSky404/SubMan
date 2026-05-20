export type ProxyType =
	| "vless"
	| "vmess"
	| "trojan"
	| "ss"
	| "ssr"
	| "hysteria2"
	| "tuic"
	| "anytls"
	| "other";

export type SourceType = "single" | "subscription";

export type NodeTag = {
	id: string;
	label: string;
};

export type SortMode = "none" | "name" | "type" | "region";

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
	renameRules?: string[];
	allowedTypes: ProxyType[];
	prependRegionFlags?: boolean;
	customRegionFlagMap?: string;
	sortMode?: SortMode;
	sortPriority?: string;
	updatedAt: string;
};

export type PublishTransitionOutcome =
	| "auto_deleted"
	| "kept_shared"
	| "kept_external"
	| "kept_manual";

export type AggregatePublishTarget = {
	id: string;
	name: string;
	ruleId: string;
	fileName: string;
	description: string;
	isPublic: boolean;
	lastPublishedAt: string | null;
	lastPublishedUrl: string | null;
	lastPublishTransitionAt: string | null;
	lastPublishTransitionFromFileName: string | null;
	lastPublishTransitionToFileName: string | null;
	lastPublishTransitionOutcome: PublishTransitionOutcome | null;
	updatedAt: string;
};

export type ClientExportType = "sing-box-client";

export type SingBoxClientExportOptions = {
	listenAddress: string;
	listenPort: number;
	inboundType: "mixed";
	dnsMode: "conservative";
	routeMode: "global-proxy";
	includeExperimental: boolean;
	selectorTag: string;
	urlTestTag: string;
};

export type ClientExportProfile = {
	id: string;
	name: string;
	type: ClientExportType;
	ruleId: string;
	fileName: string;
	options: SingBoxClientExportOptions;
	lastGeneratedAt: string | null;
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
	clientExports: ClientExportProfile[];
	gists: GistMeta[];
	activeGistId: string | null;
	activeGistFile: string;
	lastUpdated: string;
};

export type AuthState = {
	token: string | null;
	lastLoginAt: string | null;
};
