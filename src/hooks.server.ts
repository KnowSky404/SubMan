import type { Handle } from "@sveltejs/kit";

const SECURITY_HEADERS = {
	"Permissions-Policy":
		"camera=(), geolocation=(), microphone=(), payment=(), usb=()",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Content-Type-Options": "nosniff",
} as const;

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(name, value);
	}
	return response;
};
