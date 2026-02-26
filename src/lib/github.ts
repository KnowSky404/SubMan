import { browser } from '$app/environment';
import type { AuthState } from '$lib/models';

const STATE_KEY = 'subman:oauth:state';
const CODE_VERIFIER_KEY = 'subman:oauth:code-verifier';

function base64UrlEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value: string): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	return crypto.subtle.digest('SHA-256', encoder.encode(value));
}

function createVerifier(): string {
	return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export async function buildAuthorizeUrl(config: Pick<AuthState, 'clientId' | 'redirectUri' | 'scopes'>): Promise<string> {
	if (!browser) {
		return '';
	}

	const state = crypto.randomUUID();
	const verifier = createVerifier();
	const challenge = base64UrlEncode(await sha256(verifier));

	sessionStorage.setItem(STATE_KEY, state);
	sessionStorage.setItem(CODE_VERIFIER_KEY, verifier);

	const params = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		scope: config.scopes.join(' '),
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256'
	});

	return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function readCallback(search: string): { code: string | null; state: string | null; verifier: string | null } {
	if (!browser) {
		return { code: null, state: null, verifier: null };
	}

	const params = new URLSearchParams(search);
	const code = params.get('code');
	const state = params.get('state');
	const verifier = sessionStorage.getItem(CODE_VERIFIER_KEY);
	return { code, state, verifier };
}

export function verifyState(state: string | null): boolean {
	if (!browser) {
		return false;
	}
	const expected = sessionStorage.getItem(STATE_KEY);
	return Boolean(state && expected && state === expected);
}

export function clearOAuthArtifacts(): void {
	if (!browser) {
		return;
	}
	sessionStorage.removeItem(STATE_KEY);
	sessionStorage.removeItem(CODE_VERIFIER_KEY);
}
