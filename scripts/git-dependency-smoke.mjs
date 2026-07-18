import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execNpmSync } from "./npm-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "codex-app-server-client-git-smoke-"));

try {
  execNpmSync(
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      `git+${pathToFileURL(root).href}`,
    ],
    { cwd: temporaryRoot, stdio: "pipe" },
  );

  const packageRoot = join(
    temporaryRoot,
    "node_modules",
    "@jaminzhou",
    "codex-app-server-client",
  );
  if (!existsSync(join(packageRoot, "dist", "index.js"))) {
    throw new Error("Git dependency did not build dist/index.js during installation.");
  }

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'import { protocolValidationMetadata, resolveCodexBinary } from "@jaminzhou/codex-app-server-client";',
        "if (protocolValidationMetadata.validatedClientRequests !== 125) throw new Error(\"Git dependency protocol metadata is incomplete.\");",
        "const binary = resolveCodexBinary();",
        "if (!binary.executablePath) throw new Error(\"Git dependency Codex binary is missing.\");",
      ].join("\n"),
    ],
    { cwd: temporaryRoot, stdio: "inherit" },
  );

  console.log(`Git dependency smoke passed on Node ${process.versions.node}.`);
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
