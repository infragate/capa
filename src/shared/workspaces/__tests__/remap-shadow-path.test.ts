import { describe, expect, it } from "bun:test";
import { remapWrapShadowPath } from "../remap-shadow-path";

describe("remapWrapShadowPath", () => {
  const real = "/Users/me/Documents/Projects/odin";

  it("maps nested shadow workspace paths to the real project", () => {
    const shadow =
      "/Users/me/.capa/workspaces/odin-5415-cursor/odin/src/foo.ts";
    expect(remapWrapShadowPath(shadow, real)).toBe(
      "/Users/me/Documents/Projects/odin/src/foo.ts",
    );
  });

  it("maps shadow project root to real project root", () => {
    const shadow = "/Users/me/.capa/workspaces/odin-5415-cursor/odin";
    expect(remapWrapShadowPath(shadow, real)).toBe(real);
  });

  it("leaves non-shadow paths unchanged", () => {
    const p = "/Users/me/Documents/Projects/odin/src/foo.ts";
    expect(remapWrapShadowPath(p, real)).toBe(p);
  });

  it("returns input when real project path is missing", () => {
    const shadow = "/Users/me/.capa/workspaces/x/y/file.ts";
    expect(remapWrapShadowPath(shadow, null)).toBe(shadow);
  });
});
