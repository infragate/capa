export const HTML_CSP =
	"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'";

export function htmlSecurityHeaders(
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		"Content-Security-Policy": HTML_CSP,
		"X-Content-Type-Options": "nosniff",
		...extra,
	};
}
