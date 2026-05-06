const BEARER_PREFIX = "Bearer ";

async function sha256(value: string): Promise<ArrayBuffer> {
	const bytes = new TextEncoder().encode(value);
	const source = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	);
	return crypto.subtle.digest("SHA-256", source);
}

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
	const leftBytes = new Uint8Array(left);
	const rightBytes = new Uint8Array(right);
	if (leftBytes.length !== rightBytes.length) {
		return false;
	}

	let diff = 0;
	for (let index = 0; index < leftBytes.length; index += 1) {
		diff |= leftBytes[index] ^ rightBytes[index];
	}

	return diff === 0;
}

export function getBearerToken(authorization: string | null): string | null {
	if (!authorization?.startsWith(BEARER_PREFIX)) {
		return null;
	}

	const token = authorization.slice(BEARER_PREFIX.length).trim();
	return token ? token : null;
}

export async function isAuthorized(
	authorization: string | null,
	configuredToken: string | undefined,
): Promise<boolean> {
	const requestToken = getBearerToken(authorization);
	if (!requestToken || !configuredToken) {
		return false;
	}

	const [requestHash, configuredHash] = await Promise.all([
		sha256(requestToken),
		sha256(configuredToken),
	]);

	return equalBytes(requestHash, configuredHash);
}
