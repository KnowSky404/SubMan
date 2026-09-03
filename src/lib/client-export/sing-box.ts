import {
	type AggregateBuildOptions,
	buildAggregateOutput,
} from "$lib/aggregate";
import type {
	AggregateRule,
	ClientExportProfile,
	NodeItem,
	SubscriptionItem,
} from "$lib/models";
import { inferNodeNameFromRaw } from "$lib/subscription";
import { validateSingBoxClientProfile } from "./profile";
import {
	DEFAULT_SING_BOX_TARGET_VERSION,
	type SingBoxTargetVersion,
} from "./target";
import { parseProxyUriToSingBoxOutbound, type SingBoxOutbound } from "./uri";

export type SingBoxClientBuildResult = {
	content: string;
	config: unknown;
	totalLines: number;
	outbounds: number;
	skipped: number;
	warnings: string[];
	errors: string[];
};

export type SingBoxClientBuildOptions = {
	targetVersion?: SingBoxTargetVersion;
	loadSubscription?: AggregateBuildOptions["loadSubscription"];
};

type SingBoxClientConfig = {
	log: {
		level: "info";
		timestamp: true;
	};
	dns: Record<string, never>;
	inbounds: Array<Record<string, unknown>>;
	outbounds: Array<Record<string, unknown>>;
	route: {
		final: string;
	};
	experimental?: {
		cache_file: {
			enabled: true;
		};
		clash_api: {
			external_controller: string;
		};
	};
};

export async function buildSingBoxClientConfig(
	profile: ClientExportProfile,
	rule: AggregateRule | null | undefined,
	nodes: NodeItem[],
	subscriptions: SubscriptionItem[],
	options: SingBoxClientBuildOptions = {},
): Promise<SingBoxClientBuildResult> {
	const validation = validateSingBoxClientProfile(profile);
	const errors = [...validation.errors];
	if (!rule) {
		errors.push("Select an Aggregate rule");
	}
	if (errors.length > 0 || !rule) {
		return emptyResult({ errors });
	}

	const aggregate = await buildAggregateOutput(rule, nodes, subscriptions, {
		loadSubscription: options.loadSubscription,
	});
	if (aggregate.errors.length > 0) {
		return emptyResult({
			warnings: aggregate.warnings,
			errors: aggregate.errors,
			totalLines: aggregate.lines,
		});
	}

	const lines = aggregate.content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const warnings = [...aggregate.warnings];
	const reservedTags = new Set([
		profile.options.selectorTag,
		profile.options.urlTestTag,
		"selector",
		"urltest",
		"direct",
		"block",
	]);
	const usedTags = new Set<string>(reservedTags);
	const remoteOutbounds: SingBoxOutbound[] = [];
	const remoteTags: string[] = [];
	let skipped = 0;

	for (const line of lines) {
		const displayTag = inferNodeNameFromRaw(line, "proxy");
		const tag = uniqueTag(displayTag, usedTags);
		const { outbound, warning } = parseProxyUriToSingBoxOutbound(
			line,
			tag,
			options.targetVersion ?? DEFAULT_SING_BOX_TARGET_VERSION,
		);
		if (!outbound) {
			skipped += 1;
			if (warning) {
				warnings.push(warning);
			}
			continue;
		}

		outbound.tag = tag;
		remoteOutbounds.push(outbound);
		remoteTags.push(tag);
		usedTags.add(tag);
	}

	if (remoteOutbounds.length === 0) {
		return emptyResult({
			warnings,
			errors: ["No supported outbounds can be generated"],
			totalLines: lines.length,
			skipped,
		});
	}

	const config = buildConfig(profile, remoteOutbounds, remoteTags);

	return {
		content: `${JSON.stringify(config, null, 2)}\n`,
		config,
		totalLines: lines.length,
		outbounds: remoteOutbounds.length,
		skipped,
		warnings,
		errors: [],
	};
}

function buildConfig(
	profile: ClientExportProfile,
	remoteOutbounds: SingBoxOutbound[],
	remoteTags: string[],
): SingBoxClientConfig {
	const config: SingBoxClientConfig = {
		log: {
			level: "info",
			timestamp: true,
		},
		dns: {},
		inbounds: [
			{
				type: profile.options.inboundType,
				tag: "mixed-in",
				listen: profile.options.listenAddress,
				listen_port: profile.options.listenPort,
			},
		],
		outbounds: [
			{
				type: "selector",
				tag: profile.options.selectorTag,
				outbounds: [
					profile.options.urlTestTag,
					...remoteTags,
					"direct",
					"block",
				],
			},
			{
				type: "urltest",
				tag: profile.options.urlTestTag,
				outbounds: remoteTags,
			},
			...remoteOutbounds,
			{
				type: "direct",
				tag: "direct",
			},
			{
				type: "block",
				tag: "block",
			},
		],
		route: {
			final: profile.options.selectorTag,
		},
	};

	if (profile.options.includeExperimental) {
		config.experimental = {
			cache_file: {
				enabled: true,
			},
			clash_api: {
				external_controller: "127.0.0.1:9090",
			},
		};
	}

	return config;
}

function uniqueTag(baseTag: string, usedTags: Set<string>): string {
	const trimmed = baseTag.trim() || "proxy";
	if (!usedTags.has(trimmed)) {
		return trimmed;
	}

	let index = 2;
	let next = `${trimmed} ${index}`;
	while (usedTags.has(next)) {
		index += 1;
		next = `${trimmed} ${index}`;
	}
	return next;
}

function emptyResult(
	overrides: Partial<SingBoxClientBuildResult> = {},
): SingBoxClientBuildResult {
	return {
		content: "",
		config: null,
		totalLines: 0,
		outbounds: 0,
		skipped: 0,
		warnings: [],
		errors: [],
		...overrides,
	};
}
