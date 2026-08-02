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
