import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execNpmSync } from "./npm-exec.mjs";
import { withSmokeCleanup } from "./smoke-cleanup.mjs";
import { runExamples } from "./run-examples.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const typescriptCompiler = require.resolve("typescript/bin/tsc");
const temporaryRoot = mkdtempSync(join(tmpdir(), "codex-app-server-client-package-smoke-"));
const args = process.argv.slice(2);
const usePnpm = args.includes("--pnpm");
const artifactArgument = args.find((arg) => arg !== "--pnpm");

const manifest = withSmokeCleanup(temporaryRoot, () => {
  const artifact = artifactArgument ? null : parsePackOutput(
    execNpmSync(["pack", "--json", "--pack-destination", temporaryRoot], {
      cwd: root, encoding: "utf8", timeout: 120_000,
    }),
  )[0];
  const artifactPath = artifactArgument ? resolve(artifactArgument) : join(temporaryRoot, artifact.filename);
  writeFileSync(join(temporaryRoot, "package.json"), JSON.stringify({
    name: "codex-preview-consumer", version: "1.0.0", private: true, type: "module",
  }));
  if (usePnpm) {
    // Pin the consumer's installer independently of Corepack and parent lifecycle environment.
    execNpmSync(["exec", "--yes", "--package=pnpm@11.7.0", "--", "pnpm", "add", "--ignore-scripts", artifactPath], {
      cwd: temporaryRoot, stdio: "pipe", timeout: 120_000,
    });
  } else {
    execNpmSync(["install", "--ignore-scripts", "--include=optional", "--no-audit", "--no-fund", artifactPath], {
      cwd: temporaryRoot, stdio: "pipe", timeout: 120_000,
    });
  }
  const packageRoot = join(temporaryRoot, "node_modules", "@jaminzhou", "codex-app-server-client");
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  for (const path of [
    "README.md", "LICENSE", "COMPATIBILITY.md", "CONTRIBUTING.md", "RELEASING.md", "docs/api.md",
    "examples/README.md", "examples/stream.mjs", "examples/approvals.mjs", "examples/interrupt-resume.mjs",
    "dist/index.js", "dist/index.d.ts", "dist/protocol.js", "dist/protocol.d.ts",
    "SOURCES.md", "THIRD_PARTY_LICENSES/Apache-2.0.txt", "THIRD_PARTY_NOTICES.md",
    "schemas/runtime-validation.schemas.json",
  ]) {
    if (!existsSync(join(packageRoot, path))) throw new Error("Installed artifact is missing " + path);
  }
  writeFileSync(join(temporaryRoot, "consumer.mts"), [
    'import { CodexAppServerClient, type CodexTurn, resolveCodexBinary } from "@jaminzhou/codex-app-server-client";',
    'import type { ServerNotification, v2 } from "@jaminzhou/codex-app-server-client/protocol";',
    'export type InstalledProtocolTypes = [ServerNotification, v2.Thread];',
    'const client = new CodexAppServerClient({ protocolValidation: "strict" });',
    'client.onServerRequest("item/commandExecution/requestApproval", (params) => {',
    '  const id: string = params.threadId;',
    '  return { decision: "decline" };',
    '});',
    'client.onServerRequest("item/fileChange/requestApproval", () => ({ decision: "decline" }));',
    'const thread = await client.createThread({ sandbox: "read-only", ephemeral: false });',
    'const turn: CodexTurn = await thread.startTurn("hello");',
    'for await (const event of turn.events()) {',
    '  if (event.method === "item/agentMessage/delta") { const text: string = event.params.delta; }',
    '}',
    'await turn.interrupt();',
    'await client.resumeThread(thread.id);',
    'const executable: string = resolveCodexBinary().executablePath;',
    '// @ts-expect-error Invalid approval decisions must not become valid package types.',
    'client.onServerRequest("item/commandExecution/requestApproval", () => ({ decision: "approve-everything" }));',
    "",
  ].join("\n"));
  writeFileSync(join(temporaryRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      module: "NodeNext", moduleResolution: "NodeNext", noEmit: true,
      skipLibCheck: false, strict: true, target: "ES2022",
    },
    files: ["consumer.mts"],
  }));
  execFileSync(process.execPath, [typescriptCompiler, "--project", "tsconfig.json"], {
    cwd: temporaryRoot, stdio: "inherit",
  });
  // Check runtime and protocol entry points without relying on the repository's node_modules.
  writeFileSync(join(temporaryRoot, "entry-smoke.mjs"), [
    'import { existsSync } from "node:fs";',
    'import { createRequire } from "node:module";',
    'import { protocolMetadata, protocolValidationMetadata, resolveCodexBinary } from "@jaminzhou/codex-app-server-client";',
    'import { protocolMetadata as protocol } from "@jaminzhou/codex-app-server-client/protocol";',
    'const require = createRequire(import.meta.url);',
    'if (protocol.codexCliVersion !== protocolMetadata.codexCliVersion) throw new Error("Protocol export mismatch");',
    'if (protocolValidationMetadata.validatedClientRequests !== 158) throw new Error("Incomplete validation metadata");',
    'const schema = require.resolve("@jaminzhou/codex-app-server-client/schemas/runtime-validation.schemas.json");',
    'if (!existsSync(schema) || !existsSync(resolveCodexBinary().executablePath)) throw new Error("Missing installed Schema or CLI");',
  ].join("\n"));
  execFileSync(process.execPath, [join(temporaryRoot, "entry-smoke.mjs")], {
    cwd: temporaryRoot, stdio: "inherit", timeout: 30_000,
  });
  // Copy shipped examples out of the package so bare imports must resolve through the consumer.
  cpSync(join(packageRoot, "examples"), join(temporaryRoot, "examples"), { recursive: true });
  runExamples(join(temporaryRoot, "examples"), temporaryRoot);
  return manifest;
});
console.log("Node " + process.versions.node + " " + (usePnpm ? "pnpm" : "npm")
  + " installed-package smoke passed (" + manifest.name + "@" + manifest.version + "; cleanup complete).");

function parsePackOutput(output) {
  const match = [...output.matchAll(/(?:^|\n)(\[\s*\{\s*"id"\s*:)/g)].at(-1);
  if (!match) throw new Error("npm pack did not emit its JSON manifest.");
  return JSON.parse(output.slice(match.index + (output[match.index] === "\n" ? 1 : 0)));
}
