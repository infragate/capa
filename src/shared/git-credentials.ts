import { spawnSync } from "child_process";
import { tmpdir } from "os";

/**
 * Resolve Git HTTP credentials from the developer's existing helpers
 * (`git credential fill`, GCM, `gh auth token`) instead of storing tokens
 * in capa.db.
 */

const GIT_CRED_ENV: NodeJS.ProcessEnv = {
	GIT_TERMINAL_PROMPT: "0",
	GCM_INTERACTIVE: "never",
};

type StoredCred = { username: string; password: string };

let memoryStore: Map<string, StoredCred> | null = null;

export function resetGitCredentialsForTests(): void {
	memoryStore = new Map();
}

export function useMemoryGitCredentialsForTests(): Map<string, StoredCred> {
	if (!memoryStore) memoryStore = new Map();
	return memoryStore;
}

function homeLooksLikeTestSandbox(): boolean {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (!home) return false;
	const tmp = tmpdir();
	return home === tmp || home.startsWith(`${tmp}/`) || home.startsWith(`${tmp}\\`);
}

function useMemory(): boolean {
	if (process.env.CAPA_GIT_CREDENTIALS === "git") return false;
	if (memoryStore) return true;
	return homeLooksLikeTestSandbox();
}

function store(): Map<string, StoredCred> {
	if (!memoryStore) memoryStore = new Map();
	return memoryStore;
}

export function gitHostForPlatform(
	platform: string,
	host?: string | null,
): string | null {
	if (host && host.trim()) return host.trim();
	if (platform === "github") return "github.com";
	if (platform === "gitlab") return "gitlab.com";
	return null;
}

export function gitHostFromUrl(url: string): string | null {
	try {
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

const HOST_ALIASES: Record<string, string> = {
	"raw.githubusercontent.com": "github.com",
	"api.github.com": "github.com",
	"gist.github.com": "github.com",
};

export function credentialHost(host: string): string {
	const normalized = host.trim().toLowerCase();
	return HOST_ALIASES[normalized] ?? normalized;
}

function usernameForHost(host: string): string {
	if (host === "github.com" || host.endsWith(".github.com") || host === "gist.github.com") {
		return "x-access-token";
	}
	return "oauth2";
}

function formatAttrs(attrs: Record<string, string>): string {
	return `${Object.entries(attrs)
		.map(([k, v]) => `${k}=${v}`)
		.join("\n")}\n\n`;
}

function parseAttrs(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const idx = line.indexOf("=");
		if (idx <= 0) continue;
		out[line.slice(0, idx)] = line.slice(idx + 1);
	}
	return out;
}

function gitCredential(
	action: "fill" | "approve" | "reject",
	attrs: Record<string, string>,
): Record<string, string> | null {
	const result = spawnSync("git", ["credential", action], {
		input: formatAttrs(attrs),
		encoding: "utf8",
		windowsHide: true,
		env: { ...process.env, ...GIT_CRED_ENV },
	});
	if (result.status !== 0) return null;
	if (action !== "fill") return {};
	return parseAttrs(result.stdout ?? "");
}

function ghAuthToken(): string | null {
	const result = spawnSync("gh", ["auth", "token"], {
		encoding: "utf8",
		windowsHide: true,
		env: { ...process.env, GH_PROMPT_DISABLED: "1" },
	});
	if (result.status !== 0) return null;
	const token = (result.stdout ?? "").trim();
	return token.length > 0 ? token : null;
}

function isGithubHost(host: string): boolean {
	const h = host.toLowerCase();
	return h === "github.com" || h === "gist.github.com" || h.endsWith(".github.com");
}

/**
 * Return an HTTP password/token for `host`, or null if none is available.
 * Never hangs on an interactive prompt.
 */
export function fillGitHttpCredential(host: string): string | null {
	const normalized = credentialHost(host);
	if (!normalized) return null;

	if (useMemory()) {
		const mem = store().get(normalized);
		if (mem?.password) return mem.password;
		return null;
	}

	const filled = gitCredential("fill", {
		protocol: "https",
		host: normalized,
	});
	const password = filled?.password?.trim();
	if (password) return password;

	if (isGithubHost(normalized)) {
		return ghAuthToken();
	}
	return null;
}

export function approveGitHttpCredential(host: string, token: string): void {
	const normalized = credentialHost(host);
	const password = token.trim();
	if (!normalized || !password) return;

	if (useMemory()) {
		store().set(normalized, {
			username: usernameForHost(normalized),
			password,
		});
		return;
	}

	gitCredential("approve", {
		protocol: "https",
		host: normalized,
		username: usernameForHost(normalized),
		password,
	});
}

export function rejectGitHttpCredential(host: string): void {
	const normalized = credentialHost(host);
	if (!normalized) return;

	if (useMemory()) {
		store().delete(normalized);
		return;
	}

	gitCredential("reject", {
		protocol: "https",
		host: normalized,
	});
}

export function hasGitHttpCredential(host: string): boolean {
	return fillGitHttpCredential(host) != null;
}
