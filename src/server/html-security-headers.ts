export const HTML_CSP =
	"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'";

export function htmlSecurityHeaders(
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		"Content-Security-Policy": HTML_CSP,
		"X-Content-Type-Options": "nosniff",
		...extra,
	};
}
