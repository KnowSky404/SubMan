import { describe, expect, test } from "bun:test";

type Mapping = Record<string, unknown>;

declare const Bun: {
	file(path: URL): { text(): Promise<string> };
	YAML: { parse(source: string): unknown };
};

const document = asMapping(
	Bun.YAML.parse(
		await Bun.file(
			new URL("../../../../docs/api/openapi.yaml", import.meta.url),
		).text(),
	),
	"OpenAPI document",
);

function asMapping(value: unknown, label: string): Mapping {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
	}
	return value as Mapping;
}

function child(parent: Mapping, key: string): Mapping {
	return asMapping(parent[key], key);
}

function operation(path: string, method: string): Mapping {
	return child(child(child(document, "paths"), path), method);
}

function resolveLocalReference(value: unknown): Mapping {
	const reference = asMapping(value, "reference").$ref;
	if (typeof reference !== "string" || !reference.startsWith("#/")) {
		throw new TypeError("reference must be a local OpenAPI reference");
	}
	let current: unknown = document;
	for (const segment of reference.slice(2).split("/")) {
		current = asMapping(current, segment)[segment];
	}
	return asMapping(current, reference);
}

function response(path: string, method: string, status: string): Mapping {
	return resolveLocalReference(
		child(operation(path, method), "responses")[status],
	);
}

function collectLocalReferences(value: unknown, references: string[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collectLocalReferences(item, references);
		return;
	}
	if (typeof value !== "object" || value === null) return;
	for (const [key, item] of Object.entries(value)) {
		if (key === "$ref" && typeof item === "string" && item.startsWith("#/")) {
			references.push(item);
		} else {
			collectLocalReferences(item, references);
		}
	}
}

describe("public Server API OpenAPI contract", () => {
	test("publishes only supported routes with stable operation IDs", () => {
		expect(document.openapi).toBe("3.1.1");
		const paths = child(document, "paths");
		expect(Object.keys(paths).sort()).toEqual([
			"/api/health",
			"/api/nodes",
			"/api/nodes/by-key/{externalKey}",
			"/api/nodes/{id}",
		]);
		expect(operation("/api/health", "get").operationId).toBe("getApiHealth");
		expect(operation("/api/nodes", "get").operationId).toBe("listNodes");
		expect(operation("/api/nodes", "post").operationId).toBe("createNode");
		expect(operation("/api/nodes/{id}", "get").operationId).toBe("getNode");
		expect(operation("/api/nodes/{id}", "patch").operationId).toBe(
			"updateNode",
		);
		expect(operation("/api/nodes/{id}", "delete").operationId).toBe(
			"deleteNode",
		);
		expect(
			operation("/api/nodes/by-key/{externalKey}", "put").operationId,
		).toBe("upsertNodeByExternalKey");
		expect(
			Object.keys(paths).some((path) => path.startsWith("/api/workspaces")),
		).toBe(false);
	});

	test("keeps every local component reference resolvable", () => {
		const references: string[] = [];
		collectLocalReferences(document, references);
		const unresolved: string[] = [];
		for (const reference of new Set(references)) {
			try {
				resolveLocalReference({ $ref: reference });
			} catch {
				unresolved.push(reference);
			}
		}
		expect(unresolved).toEqual([]);
	});

	test("requires the SubMan bearer token except for health", () => {
		expect(document.security).toEqual([{ BearerAuth: [] }]);
		expect(operation("/api/health", "get").security).toEqual([]);
		const bearer = child(child(document, "components"), "securitySchemes");
		expect(child(bearer, "BearerAuth").type).toBe("http");
		expect(child(bearer, "BearerAuth").scheme).toBe("bearer");
	});

	test("defines revision headers and optimistic write preconditions", () => {
		const writeOperations: Array<[string, string, string]> = [
			["/api/nodes", "post", "201"],
			["/api/nodes/{id}", "patch", "200"],
			["/api/nodes/{id}", "delete", "200"],
			["/api/nodes/by-key/{externalKey}", "put", "200"],
		];
		for (const [path, method, successStatus] of writeOperations) {
			const write = operation(path, method);
			expect(write["x-success-semantics"]).toBe("remote-committed");
			expect(
				Array.isArray(write.parameters) &&
					write.parameters.some(
						(parameter) =>
							asMapping(parameter, "parameter").$ref ===
							"#/components/parameters/IfMatch",
					),
			).toBe(true);
			const responses = child(write, "responses");
			expect(successStatus in responses).toBe(true);
			expect("412" in responses).toBe(true);
			expect("429" in responses).toBe(true);

			const successHeaders = child(
				response(path, method, successStatus),
				"headers",
			);
			expect("ETag" in successHeaders).toBe(true);
			expect("X-SubMan-Revision" in successHeaders).toBe(true);
			expect("Cache-Control" in successHeaders).toBe(true);
		}

		for (const [path, method, status] of [
			["/api/nodes", "get", "200"],
			["/api/nodes/{id}", "get", "200"],
		] as const) {
			const headers = child(response(path, method, status), "headers");
			expect("ETag" in headers).toBe(true);
			expect("X-SubMan-Revision" in headers).toBe(true);
			expect("Cache-Control" in headers).toBe(true);
		}

		const components = child(document, "components");
		const schemas = child(components, "schemas");
		expect(child(schemas, "WorkspaceMetadata").required).toEqual([
			"gistId",
			"file",
			"revision",
		]);
		const rateLimited = child(child(components, "responses"), "RateLimited");
		expect("Retry-After" in child(rateLimited, "headers")).toBe(true);
	});

	test("defines the unified error envelope and safe gateway metadata", () => {
		const schemas = child(child(document, "components"), "schemas");
		const error = child(schemas, "ApiError");
		expect(error.required).toEqual(["code", "message", "disposition"]);
		expect("gateway" in child(error, "properties")).toBe(true);
		expect(child(schemas, "ErrorEnvelope").required).toEqual(["error"]);
		expect(
			"workspace" in child(child(schemas, "ErrorEnvelope"), "properties"),
		).toBe(true);
		const errorCodes = child(schemas, "ApiErrorCode").enum;
		expect(Array.isArray(errorCodes)).toBe(true);
		for (const code of [
			"precondition_failed",
			"duplicate_node_raw",
			"revision_conflict",
			"gist_write_failed",
			"server_error",
		]) {
			expect((errorCodes as unknown[]).includes(code)).toBe(true);
		}
		const gateway = child(schemas, "GitHubGatewayMetadata");
		expect(gateway.required).toEqual([
			"operation",
			"status",
			"category",
			"requestId",
			"retryAfter",
			"rateLimitReset",
		]);
		expect(child(child(gateway, "properties"), "operation").enum).toEqual([
			"gist.read",
			"gist.raw.read",
			"gist.patch",
		]);
	});

	test("marks external-key upsert as resource idempotency and exposes doc links", async () => {
		const upsert = operation("/api/nodes/by-key/{externalKey}", "put");
		expect(upsert["x-idempotency-scope"]).toBe("resource");
		expect(upsert.description).toContain("not request-replay idempotency");

		expect(child(document, "externalDocs").url).toBe("./server-api.md");
		const links = {
			narrative: "docs/api/server-api.md",
			readme: "README.md",
			readmeEnglish: "README.en.md",
			agentSkill: "docs/agents/subman-skill/references/server-api.md",
		};
		expect(child(child(document, "info"), "x-documentation")).toEqual(links);
		for (const path of Object.values(links)) {
			const source = await Bun.file(
				new URL(`../../../../${path}`, import.meta.url),
			).text();
			expect(source.length > 0).toBe(true);
		}
	});
});
