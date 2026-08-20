import type { TokenRefreshScheduler } from "./token-refresh-scheduler";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface TokenRefreshRouteDeps {
	tokenRefreshScheduler: TokenRefreshScheduler;
}

export async function handleTokenRefreshStatus(
	deps: TokenRefreshRouteDeps,
): Promise<Response> {
	try {
		const status = deps.tokenRefreshScheduler.getStatus();
		return new Response(JSON.stringify(status), { headers: JSON_HEADERS });
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

export async function handleForceTokenRefresh(
	deps: TokenRefreshRouteDeps,
): Promise<Response> {
	try {
		await deps.tokenRefreshScheduler.forceCheck();
		return new Response(
			JSON.stringify({
				success: true,
				message: "Token refresh check completed",
			}),
			{ headers: JSON_HEADERS },
		);
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: JSON_HEADERS,
		});
	}
}

/**
 * Dispatcher for `/api/token-refresh…` routes.
 * Returns null if the path is not a token-refresh route.
 */
export async function dispatchTokenRefresh(
	deps: TokenRefreshRouteDeps,
	path: string,
	method: string,
): Promise<Response | null> {
	if (path === "/api/token-refresh/status" && method === "GET") {
		return handleTokenRefreshStatus(deps);
	}
	if (path === "/api/token-refresh/check" && method === "POST") {
		return handleForceTokenRefresh(deps);
	}
	return null;
}
