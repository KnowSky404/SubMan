import { describe, expect, it } from "bun:test";
import {
	createDefaultSingBoxClientProfile,
	validateSingBoxClientProfile,
} from "./profile";

describe("sing-box client export profile", () => {
	it("creates a default profile for an aggregate rule", () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", "2026-05-12T00:00:00.000Z");

		expect(profile.name).toBe("sing-box Client");
		expect(profile.type).toBe("sing-box-client");
		expect(profile.ruleId).toBe("rule-1");
		expect(profile.fileName).toBe("sing-box-client.json");
		expect(profile.options.listenAddress).toBe("127.0.0.1");
		expect(profile.options.listenPort).toBe(2080);
		expect(profile.options.inboundType).toBe("mixed");
		expect(profile.options.routeMode).toBe("global-proxy");
		expect(profile.options.includeExperimental).toBe(true);
	});

	it("blocks invalid listen ports and protected filenames", () => {
		const profile = createDefaultSingBoxClientProfile("rule-1", "2026-05-12T00:00:00.000Z");

		expect(validateSingBoxClientProfile({ ...profile, fileName: "subman.json" }).errors).toContain(
			"Output filename cannot replace subman.json",
		);
		expect(
			validateSingBoxClientProfile({
				...profile,
				options: { ...profile.options, listenPort: 70000 },
			}).errors,
		).toContain("Listen port must be between 1 and 65535");
	});
});
