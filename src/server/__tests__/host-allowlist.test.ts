import { describe, expect, it } from "bun:test";
import {
	isAllowedHostHeader,
	misdirectedHostResponse,
	withAllowedHost,
} from "../host-allowlist";

describe("isAllowedHostHeader", () => {
	it("allows 127.0.0.1, localhost, and ::1 on the bind port", () => {
		expect(isAllowedHostHeader("127.0.0.1:5912", "127.0.0.1", 5912)).toBe(true);
		expect(isAllowedHostHeader("localhost:5912", "127.0.0.1", 5912)).toBe(true);
		expect(isAllowedHostHeader("[::1]:5912", "127.0.0.1", 5912)).toBe(true);
	});

	it("allows the configured bind host and port", () => {
		expect(isAllowedHostHeader("10.0.0.5:5912", "10.0.0.5", 5912)).toBe(true);
	});

	it("rejects an attacker DNS name on the capa port", () => {
		expect(
			isAllowedHostHeader("evil.example:5912", "127.0.0.1", 5912),
		).toBe(false);
		expect(isAllowedHostHeader("evil.example", "127.0.0.1", 5912)).toBe(false);
	});

	it("rejects a matching name on the wrong port", () => {
		expect(isAllowedHostHeader("127.0.0.1:80", "127.0.0.1", 5912)).toBe(false);
	});

	it("rejects a missing Host header", () => {
		expect(isAllowedHostHeader(null, "127.0.0.1", 5912)).toBe(false);
	});
});

describe("misdirectedHostResponse", () => {
	it("returns 421 for a rebinding Host", () => {
		const req = new Request("http://127.0.0.1:5912/api/projects", {
			headers: { Host: "evil.example:5912" },
		});
		const res = misdirectedHostResponse(req, "127.0.0.1", 5912);
		expect(res).not.toBeNull();
		expect(res!.status).toBe(421);
	});

	it("returns null for a legitimate loopback Host", () => {
		const req = new Request("http://127.0.0.1:5912/api/projects", {
			headers: { Host: "127.0.0.1:5912" },
		});
		expect(misdirectedHostResponse(req, "127.0.0.1", 5912)).toBeNull();
	});
});

describe("withAllowedHost", () => {
	it("rejects attacker Host with 421 before API handlers run", async () => {
		let apiCalled = false;
		const req = new Request("http://127.0.0.1:5912/api/projects", {
			headers: { Host: "evil.example:5912" },
		});
		const res = await withAllowedHost(req, "127.0.0.1", 5912, () => {
			apiCalled = true;
			return new Response("ok");
		});
		expect(res.status).toBe(421);
		expect(apiCalled).toBe(false);
	});

	it("runs handlers for a legitimate loopback Host", async () => {
		let apiCalled = false;
		const req = new Request("http://127.0.0.1:5912/api/projects", {
			headers: { Host: "127.0.0.1:5912" },
		});
		const res = await withAllowedHost(req, "127.0.0.1", 5912, () => {
			apiCalled = true;
			return new Response("ok");
		});
		expect(res.status).toBe(200);
		expect(apiCalled).toBe(true);
	});
});
