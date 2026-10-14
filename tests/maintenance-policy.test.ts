import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readWorkflow(name: string) {
  return readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
}

function triggers(workflow: string) {
  const block = workflow.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1];
  if (!block) throw new Error("Missing workflow trigger block");
  return block.trim();
}

describe("on-demand maintenance policy", () => {
  it.each(["codex-drift", "codex-compatibility"])(
    "keeps %s manual-only without scheduled polling",
    (name) => {
      expect(triggers(readWorkflow(name))).toBe("workflow_dispatch:");
    },
  );

  it("retains main-push and pull-request CI with the required platform gate", () => {
    const workflow = readWorkflow("ci");
    const triggerBlock = triggers(workflow);
    expect(triggerBlock).toMatch(/^push:/m);
    expect(triggerBlock).toContain("branches: [main]");
    expect(triggerBlock).toMatch(/^  pull_request:/m);
    expect(workflow).toMatch(/^  check:/m);
    expect(workflow).toContain("needs: [linux-check, macos-package-smoke, windows-package-smoke]");
  });

  it("keeps contributor guidance consistent with manual-only upstream checks", () => {
    const guidance = readFileSync(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");
    expect(guidance).toContain("manual-only");
    expect(guidance).toContain("**Run workflow**");
    expect(guidance).not.toMatch(/scheduled workflow|weekly compatibility workflow/i);
  });
});
