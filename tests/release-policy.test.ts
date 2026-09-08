import { describe, expect, it } from "vitest";
// @ts-expect-error Repository-only JavaScript tooling has no public declaration.
import { candidateMode } from "../scripts/release-policy.mjs";

const manifest = (version: string, tag: string) => ({
  version, publishConfig: { tag, access: "public", registry: "https://registry.npmjs.org/" },
});
describe("candidate packaging policy", () => {
  it("keeps previews and non-preview candidates explicit", () => {
    expect(candidateMode(manifest("0.1.0-preview.1", "next"), [])).toBe("preview");
    expect(candidateMode(manifest("0.1.0", "latest"), ["--release"])).toBe("release");
  });
  it.each([
    ["0.1.0", "latest", []], ["0.1.0-preview.0", "next", ["--release"]],
    ["0.1.0", "next", ["--release"]], ["0.1.0-preview.0", "latest", []],
    ["0.01.0", "latest", ["--release"]], ["0.1.0", "latest", ["--publish"]],
  ])("rejects mismatched version/tag/mode %s %s %j", (version, tag, args) => {
    expect(() => candidateMode(manifest(version as string, tag as string), args)).toThrow();
  });
  it("rejects private or alternate registry candidates", () => {
    const pkg = manifest("0.1.0", "latest");
    expect(() => candidateMode({ ...pkg, private: true }, ["--release"])).toThrow();
    expect(() => candidateMode({ ...pkg, publishConfig: { ...pkg.publishConfig, registry: "https://example.com/" } }, ["--release"])).toThrow();
  });
});
