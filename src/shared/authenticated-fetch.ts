/**
 * Authenticated Fetch Helper for Private Repositories
 *
 * Adds GitHub/GitLab auth headers using the developer's existing git
 * credential helper / `gh auth token`. CAPA does not store git tokens.
 */

import type { CapaDatabase } from "../db/database";
import type { GitPlatform } from "../types/git-integration";
import {
	fillGitHttpCredential,
	gitHostFromUrl,
} from "./git-credentials";
import { getGitProvider, getGitProviderByHost } from "./git-providers/registry";

export const TOKEN_EXPIRED_MESSAGE =
	"Git integration token has expired. Run `capa auth` again to re-authenticate.";

export class AuthenticatedFetch {
	private db: CapaDatabase;

	constructor(db: CapaDatabase) {
		this.db = db;
	}

	private authorizationHeader(host: string, token: string): string {
		const provider = getGitProviderByHost(host);
		if (provider) return provider.authHeader(token);

		const integrations = this.db.getAllGitIntegrations();
		const match = integrations.find(
			(row) => row.host && row.host.toLowerCase() === host.toLowerCase(),
		);
		if (match?.platform === "github-enterprise") {
			return `token ${token}`;
		}
		return `Bearer ${token}`;
	}

	private tokenForUrl(url: string): string | null {
		const host = gitHostFromUrl(url);
		if (!host) return null;
		return fillGitHttpCredential(host);
	}

	/**
	 * Get authentication headers for a URL
	 */
	private async getAuthHeaders(
		url: string,
	): Promise<Record<string, string> | null> {
		const host = gitHostFromUrl(url);
		if (!host) return null;
		const token = fillGitHttpCredential(host);
		if (!token) return null;
		return { Authorization: this.authorizationHeader(host, token) };
	}

	async fetch(url: string, options: RequestInit = {}): Promise<Response> {
		const authHeaders = await this.getAuthHeaders(url);
		const headers = new Headers(options.headers || {});
		if (authHeaders) {
			for (const [key, value] of Object.entries(authHeaders)) {
				headers.set(key, value);
			}
		}
		return fetch(url, {
			...options,
			headers,
		});
	}

	hasAuth(url: string): boolean {
		return this.tokenForUrl(url) != null;
	}

	getTokenForUrl(url: string): string | null {
		return this.tokenForUrl(url);
	}

	static isPrivateRepoError(response: Response): boolean {
		return response.status === 401 || response.status === 403;
	}
}

export function createAuthenticatedFetch(db: CapaDatabase): AuthenticatedFetch {
	return new AuthenticatedFetch(db);
}

/** @deprecated Detected platform is no longer required for clone auth. */
export type { GitPlatform };
