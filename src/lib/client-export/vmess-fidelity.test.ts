import { describe, expect, it } from "bun:test";
import { parseProxyUriToSingBoxOutbound } from "./uri";

function vmessUri(payload: Record<string, unknown>): string {
	const json = JSON.stringify(payload);
	const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
	return `vmess://${encoded}`;
}

describe("sing-box VMess fidelity", () => {
	it("omits packet_encoding when VLESS explicitly disables it", () => {
		const result = parseProxyUriToSingBoxOutbound(
			"vless://00000000-0000-4000-8000-000000000101@example.com:443?security=tls&packetEncoding=none#VLESS%20No%20Packet",
			"fallback",
		);

		expect(result.warning).toBeNull();
		expect(Boolean(result.outbound)).toBe(true);
		expect(result.outbound && "packet_encoding" in result.outbound).toBe(false);
	});

	it("omits packet_encoding when VMess explicitly disables it", () => {
		const result = parseProxyUriToSingBoxOutbound(
			vmessUri({
				add: "example.com",
				port: 443,
				id: "00000000-0000-4000-8000-000000000102",
				packetEncoding: "none",
			}),
			"VMess No Packet",
		);

		expect(result.warning).toBeNull();
		expect(Boolean(result.outbound)).toBe(true);
		expect(result.outbound && "packet_encoding" in result.outbound).toBe(false);
	});

	it("preserves supported VMess security and protocol booleans", () => {
		const result = parseProxyUriToSingBoxOutbound(
			vmessUri({
				add: "legacy.example.com",
				port: "443",
				id: "00000000-0000-4000-8000-000000000103",
				scy: "aes-128-gcm",
				aid: "1",
				globalPadding: "1",
				authenticated_length: 0,
			}),
			"Legacy VMess",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound).toEqual({
			type: "vmess",
			tag: "Legacy VMess",
			server: "legacy.example.com",
			server_port: 443,
			uuid: "00000000-0000-4000-8000-000000000103",
			security: "aes-128-gcm",
			alter_id: 1,
			global_padding: true,
			authenticated_length: false,
		});
	});

	it("rejects aes-128-ctr because sing-box 1.14 cannot initialize it", () => {
		const result = parseProxyUriToSingBoxOutbound(
			vmessUri({
				add: "legacy.example.com",
				port: 443,
				id: "00000000-0000-4000-8000-000000000103",
				scy: "aes-128-ctr",
			}),
			"Legacy VMess",
		);

		expect(result.outbound).toBeNull();
		expect(result.warning).toContain("unsupported security");
	});

	it("accepts aes-128-cfb because sing-box 1.14 still supports it", () => {
		const result = parseProxyUriToSingBoxOutbound(
			vmessUri({
				add: "legacy.example.com",
				port: 443,
				id: "00000000-0000-4000-8000-000000000103",
				scy: "aes-128-cfb",
			}),
			"Legacy VMess",
		);

		expect(result.warning).toBeNull();
		expect(result.outbound?.security).toBe("aes-128-cfb");
	});

	it("continues to reject unknown packet encodings", () => {
		const result = parseProxyUriToSingBoxOutbound(
			vmessUri({
				add: "example.com",
				port: 443,
				id: "00000000-0000-4000-8000-000000000104",
				packet_encoding: "unsupported",
			}),
			"Invalid VMess",
		);

		expect(result.outbound).toBeNull();
		expect(result.warning).toContain("unsupported packet encoding");
	});
});
