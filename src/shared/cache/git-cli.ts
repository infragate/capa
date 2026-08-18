import type { ExecFileOptions } from "child_process";
import * as childProcess from "child_process";

/** Git -c flags that disable LFS smudge/clean so clones work without git-lfs or LFS API access. */
export const LFS_SKIP_ARGS = [
	"-c",
	"filter.lfs.smudge=",
	"-c",
	"filter.lfs.clean=",
	"-c",
	"filter.lfs.process=",
	"-c",
	"filter.lfs.required=false",
];

/**
 * Run git with LFS filters disabled. Skills only need text files (SKILL.md, etc.),
 * never LFS-backed binary blobs.
 */
export function gitCommandArgs(args: string[]): string[] {
	return [...LFS_SKIP_ARGS, ...args];
}

/**
 * Environment that forces git to run non-interactively. Without these, cloning a
 * private repo with no usable credentials makes git block forever on a terminal
 * prompt (`Username for 'https://github.com':`) that capa never answers — the
 * install just hangs. With them set, git fails fast and the error is surfaced to
 * the user (see `explainGitError`).
 */
const NON_INTERACTIVE_GIT_ENV: Record<string, string> = {
	// Don't fall back to an interactive terminal prompt for HTTP(S) credentials.
	GIT_TERMINAL_PROMPT: "0",
	// Don't let Git Credential Manager open an interactive GUI/browser prompt.
	GCM_INTERACTIVE: "never",
	// Defensive: if a repo resolves to SSH, fail fast instead of blocking on a
	// password/passphrase or host-key confirmation. A user-set GIT_SSH_COMMAND wins.
	GIT_SSH_COMMAND:
		process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes -o ConnectTimeout=10",
};

/**
 * Pass an HTTP credential to git without putting it in argv or the remote URL.
 * Uses GIT_CONFIG_* env indirection so `http.extraHeader` is not visible in `ps`.
 */
export function gitHttpCredentialEnv(token: string): Record<string, string> {
	const parsed = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? "0", 10);
	const n = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	const basic = Buffer.from(`oauth2:${token}`, "utf8").toString("base64");
	return {
		GIT_TERMINAL_PROMPT: "0",
		GIT_CONFIG_COUNT: String(n + 1),
		[`GIT_CONFIG_KEY_${n}`]: "http.extraHeader",
		[`GIT_CONFIG_VALUE_${n}`]: `Authorization: Basic ${basic}`,
	};
}

export async function git(
	args: string[],
	opts: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		childProcess.execFile(
			"git",
			gitCommandArgs(args),
			{
				...opts,
				windowsHide: true,
				env: {
					...process.env,
					GIT_LFS_SKIP_SMUDGE: "1",
					...NON_INTERACTIVE_GIT_ENV,
					...(opts.env ?? {}),
				},
			},
			(err, stdout, stderr) => {
				if (err) {
					reject(err);
					return;
				}
				resolve({
					stdout: String(stdout ?? ""),
					stderr: String(stderr ?? ""),
				});
			},
		);
	});
}
