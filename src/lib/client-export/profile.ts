import type {
	ClientExportProfile,
	SingBoxClientExportOptions,
} from "$lib/models";
import { createId } from "$lib/utils/id";

export const DEFAULT_SING_BOX_CLIENT_OPTIONS: SingBoxClientExportOptions = {
	listenAddress: "127.0.0.1",
	listenPort: 2080,
	inboundType: "mixed",
	dnsMode: "conservative",
	routeMode: "global-proxy",
	includeExperimental: true,
	selectorTag: "proxy",
	urlTestTag: "auto",
};

export function createDefaultSingBoxClientProfile(
	ruleId: string,
	now: string,
): ClientExportProfile {
	return {
		id: createId("export"),
		name: "sing-box Client",
		type: "sing-box-client",
		ruleId,
		fileName: "sing-box-client.json",
		options: { ...DEFAULT_SING_BOX_CLIENT_OPTIONS },
		lastGeneratedAt: null,
		lastPublishedAt: null,
		lastPublishedUrl: null,
		updatedAt: now,
	};
}

export function normalizeExportFileName(value: string): string {
	return value.trim().replace(/^\/+/, "");
}

export function validateSingBoxClientProfile(profile: ClientExportProfile): {
	errors: string[];
} {
	const errors: string[] = [];
	const fileName = normalizeExportFileName(profile.fileName);

	if (!profile.ruleId) {
		errors.push("Select an Aggregate rule");
	}
	if (!fileName) {
		errors.push("Output filename is required");
	}
	if (fileName.toLowerCase() === "subman.json") {
		errors.push("Output filename cannot replace subman.json");
	}
	if (
		!Number.isInteger(profile.options.listenPort) ||
		profile.options.listenPort < 1 ||
		profile.options.listenPort > 65535
	) {
		errors.push("Listen port must be between 1 and 65535");
	}
	if (!profile.options.listenAddress.trim()) {
		errors.push("Listen address is required");
	}
	if (!profile.options.selectorTag.trim()) {
		errors.push("Selector tag is required");
	}
	if (!profile.options.urlTestTag.trim()) {
		errors.push("URL test tag is required");
	}

	return { errors };
}
