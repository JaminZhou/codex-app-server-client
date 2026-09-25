import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error Repository-only JavaScript tooling has no public declaration.
import { candidateMode } from "../scripts/release-policy.mjs";

const manifest = (version: string, tag: string) => ({
  version, publishConfig: { tag, access: "public", registry: "https://registry.npmjs.org/" },
});
describe("candidate packaging policy", () => {
  it("keeps shipped exact-version installation and troubleshooting aligned with the package", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const examples = readFileSync(new URL("../examples/README.md", import.meta.url), "utf8");
    const row = examples.split("\n").find((line) => line.startsWith("| npm returns 404"));
    expect(row).toContain(`npm view ${pkg.name}@${pkg.version} version`);
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toContain(`npm view ${pkg.name}@${pkg.version} version`);
    expect(readme).toContain("pnpm package:smoke");
    expect(readme).not.toContain("pnpm release:pack");
    expect(readme).not.toContain(`codex-app-server-client-${pkg.version}.tgz`);
    const compatibility = readFileSync(new URL("../COMPATIBILITY.md", import.meta.url), "utf8");
    expect(compatibility).toContain("release candidate has been published");
    expect(compatibility).toContain("new unpublished version");
    expect(compatibility).not.toContain("For a `0.2.2` release candidate");
    const releasing = readFileSync(new URL("../RELEASING.md", import.meta.url), "utf8");
    expect(releasing).toContain("codex-app-server-client-VERSION.tgz");
    expect(releasing).toContain(`./docs/releases/${pkg.version}.md`);
    expect(releasing).toContain("Historical 0.2.2 preparation record");
    expect(releasing).toContain("Do not rerun candidate or");
    expect(releasing).toContain("unpublished exact version");
    expect(releasing).not.toContain("`latest` for `0.2.2`");
    const releaseGuide = readFileSync(
      new URL(`../docs/releases/${pkg.version}.md`, import.meta.url),
      "utf8",
    );
    expect(releaseGuide).toContain(`@jaminzhou/codex-app-server-client@${pkg.version}`);
    expect(releaseGuide).toMatch(/source record alone does not prove the\s+version has been published/);
    expect(releaseGuide).toContain("thread/rollback");
    const security = readFileSync(new URL("../SECURITY.md", import.meta.url), "utf8");
    expect(security).toContain("Check the registry's current `latest` metadata");
    expect(security).toContain("older client versions and previews");
    const trusted = readFileSync(new URL("../docs/trusted-publishing.md", import.meta.url), "utf8");
    expect(trusted).toContain("version=NEW_UNPUBLISHED_VERSION");
    expect(trusted).not.toContain("version=0.2.2");
    expect(trusted).toContain("RELEASING.md#future-publication-gates");
    expect(trusted).toContain("verify live repository write access");
    expect(trusted).toMatch(/another write-capable\s+actor is added/);
    const candidateWorkflow = readFileSync(
      new URL("../.github/workflows/npm-release-candidate.yml", import.meta.url),
      "utf8",
    );
    expect(candidateWorkflow).toContain("Report the exact identity to Jamin.");
    expect(candidateWorkflow).toContain("verified write/environment boundaries are unchanged");
    const archivedRelease = readFileSync(new URL("../docs/releases/0.2.2.md", import.meta.url), "utf8");
    expect(archivedRelease).toContain("0.2.2 historical release record");
    expect(archivedRelease).toContain("not an active candidate or publication procedure");
  });
  it("keeps previews and non-preview candidates explicit", () => {
    expect(candidateMode(manifest("0.1.0-preview.1", "next"), [])).toBe("preview");
    expect(candidateMode(manifest("0.1.0", "latest"), ["--release"])).toBe("release");
    expect(candidateMode(manifest("0.2.0", "latest"), ["--release"])).toBe("release");
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
