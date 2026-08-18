import { getAuthToken } from "../../server/auth-middleware";

export function localApiHeaders(
	extra: Record<string, string> = {},
): Record<string, string> {
	const token = getAuthToken();
	return {
		...extra,
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
}
