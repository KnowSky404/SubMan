export const SING_BOX_TARGETS = {
	"1.14": {
		version: "1.14",
		binaryVersion: "1.14.0",
		validationImage:
			"ghcr.io/sagernet/sing-box:v1.14.0@sha256:4bed9332a0013fef72c31200a84e8fc0ed91a5ab2fe373a69f0acbbbbfbef3c5",
		vmessSecurity: [
			"auto",
			"none",
			"zero",
			"aes-128-cfb",
			"aes-128-gcm",
			"chacha20-poly1305",
		],
		shadowsocksMethods: [
			"2022-blake3-aes-128-gcm",
			"2022-blake3-aes-256-gcm",
			"2022-blake3-chacha20-poly1305",
			"none",
			"aes-128-gcm",
			"aes-192-gcm",
			"aes-256-gcm",
			"chacha20-ietf-poly1305",
			"xchacha20-ietf-poly1305",
			"aes-128-ctr",
			"aes-192-ctr",
			"aes-256-ctr",
			"aes-128-cfb",
			"aes-192-cfb",
			"aes-256-cfb",
			"rc4-md5",
			"chacha20-ietf",
			"xchacha20",
		],
		shadowsocksPlugins: ["obfs-local", "v2ray-plugin"],
		hysteria2Obfs: ["salamander", "gecko"],
		utlsFingerprints: [
			"chrome",
			"firefox",
			"edge",
			"safari",
			"360",
			"qq",
			"ios",
			"android",
			"random",
			"randomized",
		],
	},
} as const;

export type SingBoxTargetVersion = keyof typeof SING_BOX_TARGETS;
export type SingBoxTarget = (typeof SING_BOX_TARGETS)[SingBoxTargetVersion];

export const DEFAULT_SING_BOX_TARGET_VERSION: SingBoxTargetVersion = "1.14";

export function getSingBoxTarget(
	version: SingBoxTargetVersion = DEFAULT_SING_BOX_TARGET_VERSION,
): SingBoxTarget {
	return SING_BOX_TARGETS[version];
}

export function supportsVmessSecurity(
	target: SingBoxTarget,
	security: string,
): boolean {
	return target.vmessSecurity.some((candidate) => candidate === security);
}

export function supportsHysteria2Obfs(
	target: SingBoxTarget,
	obfs: string,
): obfs is SingBoxTarget["hysteria2Obfs"][number] {
	return target.hysteria2Obfs.some((candidate) => candidate === obfs);
}

export function supportsShadowsocksMethod(
	target: SingBoxTarget,
	method: string,
): boolean {
	return target.shadowsocksMethods.some((candidate) => candidate === method);
}

export function supportsShadowsocksPlugin(
	target: SingBoxTarget,
	plugin: string,
): boolean {
	return target.shadowsocksPlugins.some((candidate) => candidate === plugin);
}

export function supportsUtlsFingerprint(
	target: SingBoxTarget,
	fingerprint: string,
): boolean {
	return target.utlsFingerprints.some((candidate) => candidate === fingerprint);
}
