import { lookup } from "dns/promises";
import { isIP } from "net";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB

/**
 * Reject hostnames / IP literals that resolve to loopback, link-local,
 * private, or otherwise non-public destinations (SSRF guard).
 */
export function isBlockedHostnameOrIp(host: string): boolean {
	const h = host.toLowerCase().replace(/^\[|\]$/g, "");
	if (
		h === "localhost" ||
		h.endsWith(".localhost") ||
		h === "::1" ||
		h === "0.0.0.0" ||
		h === "::" ||
		h === "metadata.google.internal"
	) {
		return true;
	}

	const ipVersion = isIP(h);
	if (ipVersion === 4) return isBlockedIpv4(h);
	if (ipVersion === 6) return isBlockedIpv6(h);
	return false;
}

function isBlockedIpv4(ip: string): boolean {
	const parts = ip.split(".").map((p) => Number(p));
	if (
		parts.length !== 4 ||
		parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
	) {
		return true;
	}
	const [a, b] = parts;
	if (a === 10) return true; // 10.0.0.0/8
	if (a === 127) return true; // loopback
	if (a === 0) return true; // "this" network
	if (a === 169 && b === 254) return true; // link-local / cloud metadata
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
	if (a === 192 && b === 168) return true; // 192.168.0.0/16
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
	if (a >= 224) return true; // multicast / reserved
	return false;
}

function isBlockedIpv6(ip: string): boolean {
	const normalized = ip.toLowerCase();
	if (normalized === "::1" || normalized === "::") return true;
	// Unique local fc00::/7, link-local fe80::/10
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
	if (
		normalized.startsWith("fe8") ||
		normalized.startsWith("fe9") ||
		normalized.startsWith("fea") ||
		normalized.startsWith("feb")
	) {
		return true;
	}
	// IPv4-mapped ::ffff:x.x.x.x
	const v4mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (v4mapped) return isBlockedIpv4(v4mapped[1]);
	return false;
}

/**
 * Parse `urlString` and ensure it is a public https URL (no credentials).
 * Resolves DNS and rejects private/reserved addresses.
 */
export async function assertPublicHttpsUrl(urlString: string): Promise<URL> {
	let u: URL;
	try {
		u = new URL(urlString);
	} catch {
		throw new Error(`Invalid URL: ${urlString}`);
	}
	if (u.protocol !== "https:") {
		throw new Error(`Only https URLs are allowed (got ${u.protocol})`);
	}
	if (u.username || u.password) {
		throw new Error("URLs with embedded credentials are not allowed");
	}
	if (isBlockedHostnameOrIp(u.hostname)) {
		throw new Error(`URL host is not allowed: ${u.hostname}`);
	}

	// Literal public IPs need no further DNS check.
	if (isIP(u.hostname)) {
		return u;
	}

	try {
		const records = await lookup(u.hostname, { all: true });
		for (const rec of records) {
			if (isBlockedHostnameOrIp(rec.address)) {
				throw new Error(
					`URL host resolves to a private address (${rec.address})`,
				);
			}
		}
	} catch (err: unknown) {
		if (
			err instanceof Error &&
			/private address|not allowed/i.test(err.message)
		) {
			throw err;
		}
		// DNS failure — treat as unsafe rather than fetching blindly
		throw new Error(
			`Could not resolve host "${u.hostname}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	return u;
}

/**
 * Server-side fetch for untrusted remote skill URLs with SSRF guards:
 * public https only, DNS private-IP check, limited redirects, timeout, size cap.
 */
export async function fetchPublicHttpsText(
	urlString: string,
	fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
	let current = await assertPublicHttpsUrl(urlString);

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const response = await fetchImpl(current.toString(), {
			method: "GET",
			redirect: "manual",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: { Accept: "text/plain, text/markdown, */*" },
		});

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (!location) {
				throw new Error(`Redirect without Location from ${current}`);
			}
			const next = new URL(location, current);
			current = await assertPublicHttpsUrl(next.toString());
			continue;
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} fetching ${current}`);
		}

		const lengthHeader = response.headers.get("content-length");
		if (lengthHeader) {
			const len = Number(lengthHeader);
			if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
				throw new Error(`Response too large (${len} bytes)`);
			}
		}

		const buf = await response.arrayBuffer();
		if (buf.byteLength > MAX_BODY_BYTES) {
			throw new Error(`Response too large (${buf.byteLength} bytes)`);
		}
		return new TextDecoder("utf-8").decode(buf);
	}

	throw new Error(`Too many redirects fetching ${urlString}`);
}
