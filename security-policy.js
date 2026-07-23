/** @type {NonNullable<NonNullable<import('@sveltejs/kit').Config['kit']>['csp']>} */
export const contentSecurityPolicy = {
	mode: "nonce",
	directives: {
		"default-src": ["self"],
		"base-uri": ["self"],
		"connect-src": ["self", "https:"],
		"font-src": ["self"],
		"form-action": ["self"],
		"frame-ancestors": ["none"],
		"img-src": ["self", "data:", "blob:"],
		"manifest-src": ["self"],
		"object-src": ["none"],
		"script-src": ["self"],
		"style-src": ["self", "unsafe-inline"],
	},
};
