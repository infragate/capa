import { describe, expect, it } from "bun:test";
import {
	capaShSegmentsFromQualifiedToolName,
	capaShSegmentsMatchQualifiedTool,
	parseCapaShSegmentsFromShellText,
} from "../activity-capa-sh-command";

describe("activity-capa-sh-command", () => {
	it("slugifies qualified tool names like capa sh", () => {
		expect(capaShSegmentsFromQualifiedToolName("pagerduty.list_incidents")).toEqual([
			"pagerduty",
			"list-incidents",
		]);
		expect(capaShSegmentsFromQualifiedToolName("atlassian.jira_get_ticket")).toEqual([
			"atlassian",
			"jira-get-ticket",
		]);
	});

	it("matches kebab-case shell argv to snake_case tool ids", () => {
		const segments = parseCapaShSegmentsFromShellText(
			"cd /tmp && capa sh pagerduty list-incidents --statuses triggered --limit 5",
		);
		expect(segments).toEqual(["pagerduty", "list-incidents"]);
		expect(capaShSegmentsMatchQualifiedTool(segments!, "pagerduty.list_incidents")).toBe(
			true,
		);
	});

	it("parses nested server/group/tool segments", () => {
		const segments = parseCapaShSegmentsFromShellText(
			"capa sh atlassian jira-get-ticket --issue-key FOO-1",
		);
		expect(segments).toEqual(["atlassian", "jira-get-ticket"]);
		expect(
			capaShSegmentsMatchQualifiedTool(segments!, "atlassian.jira_get_ticket"),
		).toBe(true);
	});
});
