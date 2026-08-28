import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execNpmSync } from "./npm-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const typescriptCompiler = require.resolve("typescript/bin/tsc");
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
  execNpmSync(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "@types/node@26.1.1",
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

  writeFileSync(
    join(temporaryRoot, "consumer.ts"),
    [
      'import { CodexAppServerClient, type JsonRpcNotification } from "@jaminzhou/codex-app-server-client";',
      'import type { ServerNotification, v2 } from "@jaminzhou/codex-app-server-client/protocol";',
      "",
      "export type InstalledGitTypes = [",
      "  CodexAppServerClient,",
      "  JsonRpcNotification,",
      "  ServerNotification,",
      "  v2.Thread,",
      "];",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(temporaryRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
        },
        files: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
  );
  execFileSync(process.execPath, [typescriptCompiler, "--project", "tsconfig.json"], {
    cwd: temporaryRoot,
    stdio: "inherit",
  });

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'import { protocolValidationMetadata, resolveCodexBinary } from "@jaminzhou/codex-app-server-client";',
        "if (protocolValidationMetadata.validatedClientRequests !== 156) throw new Error(\"Git dependency protocol metadata is incomplete.\");",
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
