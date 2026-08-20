import { afterEach, describe, expect, it } from "bun:test";
import { isAllowedOrigin } from "../cors-origin";

describe("isAllowedOrigin", () => {
	const prev = process.env.CAPA_ALLOWED_ORIGINS;

	afterEach(() => {
		if (prev === undefined) delete process.env.CAPA_ALLOWED_ORIGINS;
		else process.env.CAPA_ALLOWED_ORIGINS = prev;
	});

	it("allows Origin equal to the configured UI origin", () => {
		expect(isAllowedOrigin("http://127.0.0.1:5912", "127.0.0.1", 5912)).toEqual({
			allowed: true,
			origin: "http://127.0.0.1:5912",
		});
	});

	it("allows loopback aliases for the same port when bound to 127.0.0.1", () => {
		expect(isAllowedOrigin("http://localhost:5912", "127.0.0.1", 5912)).toEqual({
			allowed: true,
			origin: "http://localhost:5912",
		});
		expect(isAllowedOrigin("http://[::1]:5912", "127.0.0.1", 5912)).toEqual({
			allowed: true,
			origin: "http://[::1]:5912",
		});
	});

	it("allows loopback aliases when bound to wildcard 0.0.0.0", () => {
		expect(isAllowedOrigin("http://127.0.0.1:5912", "0.0.0.0", 5912)).toEqual({
			allowed: true,
			origin: "http://127.0.0.1:5912",
		});
		expect(isAllowedOrigin("http://localhost:5912", "0.0.0.0", 5912)).toEqual({
			allowed: true,
			origin: "http://localhost:5912",
		});
	});

	it("rejects other localhost ports unless listed in CAPA_ALLOWED_ORIGINS", () => {
		delete process.env.CAPA_ALLOWED_ORIGINS;
		expect(isAllowedOrigin("http://localhost:5173", "127.0.0.1", 5912)).toEqual({
			allowed: false,
		});
		expect(isAllowedOrigin("http://[::1]:5173", "127.0.0.1", 5912)).toEqual({
			allowed: false,
		});

		process.env.CAPA_ALLOWED_ORIGINS = "http://localhost:5173";
		expect(isAllowedOrigin("http://localhost:5173", "127.0.0.1", 5912)).toEqual({
			allowed: true,
			origin: "http://localhost:5173",
		});
	});

	it("rejects non-loopback origins unless listed in CAPA_ALLOWED_ORIGINS", () => {
		delete process.env.CAPA_ALLOWED_ORIGINS;
		expect(isAllowedOrigin("http://example.com", "127.0.0.1", 5912)).toEqual({
			allowed: false,
		});

		process.env.CAPA_ALLOWED_ORIGINS = "https://app.example.com";
		expect(isAllowedOrigin("https://app.example.com", "127.0.0.1", 5912)).toEqual({
			allowed: true,
			origin: "https://app.example.com",
		});
	});
});
