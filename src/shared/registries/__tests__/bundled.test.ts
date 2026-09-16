import { describe, it, expect } from "bun:test";
import {
	BUNDLED_ADAPTER_SLUGS,
	assertBundledAdapterPin,
	readBundledAdapterSource,
} from "../bundled";

describe("bundled adapters", () => {
	it("embeds raw adapter source matching the compiled pins", () => {
		for (const slug of BUNDLED_ADAPTER_SLUGS) {
			const content = readBundledAdapterSource(slug);
			expect(content).toContain("export default adapter");
			expect(() => assertBundledAdapterPin(slug, content)).not.toThrow();
		}
	});
});
