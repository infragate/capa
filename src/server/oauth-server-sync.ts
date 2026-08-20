import type {
	MCPServer,
	OAuth2Config as CapabilitiesOAuth2Config,
} from "../types/capabilities";
import type { OAuth2Config } from "../types/oauth";
import type { OAuth2Manager } from "./oauth-manager";

function readEmbeddedClientId(
	oauth: CapabilitiesOAuth2Config | undefined,
): string | undefined {
	if (!oauth) return undefined;
	return (
		oauth.client_id ??
		oauth.clientId ??
		(oauth as { CLIENT_ID?: string }).CLIENT_ID ??
		oauth.oauth?.clientId ??
		(oauth.oauth as { client_id?: string } | undefined)?.client_id
	);
}

function readEmbeddedCallbackPort(
	oauth: CapabilitiesOAuth2Config | undefined,
): number | undefined {
	if (!oauth) return undefined;
	const raw =
		oauth.callback_port ??
		oauth.callbackPort ??
		(oauth as { CALLBACK_PORT?: number | string }).CALLBACK_PORT;
	if (typeof raw === "number" && raw > 0) return raw;
	if (typeof raw === "string") {
		const parsed = Number(raw);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

/** Copy plugin-embedded OAuth credentials onto an existing block without dropping discovery fields. */
export function mergeEmbeddedOAuthFields(
	target: CapabilitiesOAuth2Config | undefined,
	embedded: CapabilitiesOAuth2Config | undefined,
): CapabilitiesOAuth2Config | undefined {
	if (!target && !embedded) return undefined;
	const merged: CapabilitiesOAuth2Config = { ...(target ?? {}) };

	const clientId = readEmbeddedClientId(embedded);
	if (clientId && !readEmbeddedClientId(merged)) {
		merged.client_id = clientId;
	}

	const callbackPort = readEmbeddedCallbackPort(embedded);
	if (callbackPort != null && readEmbeddedCallbackPort(merged) == null) {
		merged.callback_port = callbackPort;
	}

	const clientSecret =
		embedded?.clientSecret ??
		(embedded as { client_secret?: string } | undefined)?.client_secret;
	if (clientSecret && !merged.clientSecret) {
		merged.clientSecret = clientSecret;
	}

	return merged;
}

/** Restore plugin oauth2 credentials on session capabilities before OAuth sync/persist. */
export function mergePluginEmbeddedOAuth(
	capabilities: { servers: MCPServer[] },
	pluginCapabilities: { servers: MCPServer[] },
): void {
	const pluginById = new Map(pluginCapabilities.servers.map((s) => [s.id, s]));
	for (const server of capabilities.servers) {
		const pluginOAuth = pluginById.get(server.id)?.def.oauth2;
		if (!pluginOAuth) continue;
		server.def.oauth2 = mergeEmbeddedOAuthFields(server.def.oauth2, pluginOAuth);
	}
}

export function serverHasExplicitAuthHeader(server: MCPServer): boolean {
	return !!(
		server.def.headers &&
		Object.keys(server.def.headers).some(
			(k) => k.toLowerCase() === "authorization",
		)
	);
}

/** Merge auto-detected OAuth endpoints with plugin-embedded client_id / callback_port. */
export function mergeDetectedOAuth2(
	existingOAuth: CapabilitiesOAuth2Config | undefined,
	oauth2Config: OAuth2Config,
): OAuth2Config {
	const merged: OAuth2Config = { ...(existingOAuth ?? {}), ...oauth2Config };
	const embeddedClientId = readEmbeddedClientId(existingOAuth);
	if (embeddedClientId) merged.client_id = embeddedClientId;

	const embeddedCallbackPort = readEmbeddedCallbackPort(existingOAuth);
	if (embeddedCallbackPort != null) merged.callback_port = embeddedCallbackPort;
	return merged;
}

export type OAuth2ServerEntry = {
	serverId: string;
	serverUrl: string;
	displayName: string;
	isConnected: boolean;
};

export type SyncServerOAuth2Result = {
	changed: boolean;
	entry: OAuth2ServerEntry | null;
};

/**
 * Probe the live MCP URL and align def.oauth2 with what the server actually needs.
 * Clears stale OAuth config when the URL no longer returns 401 + WWW-Authenticate.
 */
export async function syncServerOAuth2Requirement(
	projectId: string,
	server: MCPServer,
	oauth2Manager: OAuth2Manager,
): Promise<SyncServerOAuth2Result> {
	if (!server.def.url) {
		return { changed: false, entry: null };
	}

	if (serverHasExplicitAuthHeader(server)) {
		if (server.def.oauth2) {
			delete server.def.oauth2;
			oauth2Manager.disconnect(projectId, server.id);
			return { changed: true, entry: null };
		}
		return { changed: false, entry: null };
	}

	const existingOAuth = server.def.oauth2;
	try {
		const detected = await oauth2Manager.detectOAuth2Requirement(server.def.url, {
			tlsSkipVerify: server.def.tlsSkipVerify,
		});

		if (detected) {
			const merged = mergeDetectedOAuth2(existingOAuth, detected);
			const changed =
				!existingOAuth ||
				JSON.stringify(existingOAuth) !== JSON.stringify(merged);
			server.def.oauth2 = merged;

			let isConnected = oauth2Manager.isServerConnected(projectId, server.id);
			// Token row presence is the source of truth for "authenticated" in the UI.
			// Refresh may fail transiently without invalidating stored credentials.

			return {
				changed,
				entry: {
					serverId: server.id,
					serverUrl: server.def.url,
					displayName: server.displayName ?? server.id,
					isConnected,
				},
			};
		}

		if (existingOAuth) {
			delete server.def.oauth2;
			oauth2Manager.disconnect(projectId, server.id);
			return { changed: true, entry: null };
		}

		return { changed: false, entry: null };
	} catch {
		// Transient probe failures should not strip a working OAuth config.
		if (!existingOAuth) return { changed: false, entry: null };
		const isConnected = oauth2Manager.isServerConnected(projectId, server.id);
		return {
			changed: false,
			entry: {
				serverId: server.id,
				serverUrl: server.def.url,
				displayName: server.displayName ?? server.id,
				isConnected,
			},
		};
	}
}

export type SyncAllServersOAuth2Result = {
	changed: boolean;
	entries: OAuth2ServerEntry[];
};

/**
 * Probe URL-based servers and align def.oauth2 with live requirements.
 * When `onlyWithExistingOAuth` is true, skips servers with no oauth2 block
 * (avoids probing every server on each project page load).
 */
export async function syncAllServersOAuth2Requirements(
	projectId: string,
	capabilities: { servers: MCPServer[] },
	oauth2Manager: OAuth2Manager,
	options?: { onlyWithExistingOAuth?: boolean },
): Promise<SyncAllServersOAuth2Result> {
	const onlyWithExistingOAuth = options?.onlyWithExistingOAuth === true;
	let changed = false;
	const entries: OAuth2ServerEntry[] = [];

	for (const server of capabilities.servers) {
		if (!server.def.url) continue;
		if (onlyWithExistingOAuth && !server.def.oauth2) continue;

		const sync = await syncServerOAuth2Requirement(
			projectId,
			server,
			oauth2Manager,
		);
		if (sync.changed) changed = true;
		if (sync.entry) entries.push(sync.entry);
	}

	return { changed, entries };
}
