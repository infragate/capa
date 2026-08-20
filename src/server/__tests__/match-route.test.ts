import { describe, expect, test } from "bun:test";
import { matchRoute } from "../match-route";

describe("matchRoute", () => {
	test("matches named params", () => {
		expect(
			matchRoute("/api/projects/abc/activity", "/api/projects/:id/activity"),
		).toEqual({ id: "abc" });
	});

	test("returns null on miss", () => {
		expect(
			matchRoute("/api/projects/abc", "/api/projects/:id/activity"),
		).toBeNull();
	});

	test("decodes percent-encoded segments", () => {
		expect(
			matchRoute(
				"/api/projects/p1/variables/my%20key",
				"/api/projects/:projectId/variables/:name",
			),
		).toEqual({ projectId: "p1", name: "my key" });
	});

	test("captures multi-segment tails with :param+", () => {
		expect(
			matchRoute(
				"/api/registries/foo/view/a/b/c",
				"/api/registries/:slug/view/:item+",
			),
		).toEqual({ slug: "foo", item: "a/b/c" });
	});
});
