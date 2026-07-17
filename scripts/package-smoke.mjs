import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "codex-app-server-client-package-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  const packed = JSON.parse(
    execFileSync(npm, ["pack", "--json", "--pack-destination", temporaryRoot], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  const artifact = packed[0];
  if (!artifact || typeof artifact.filename !== "string" || !Array.isArray(artifact.files)) {
    throw new Error("npm pack did not return a package manifest.");
  }

  const packedPaths = new Set(artifact.files.map((file) => file.path));
  for (const requiredPath of [
    "SOURCES.md",
    "THIRD_PARTY_LICENSES/Apache-2.0.txt",
    "THIRD_PARTY_NOTICES.md",
    "schemas/runtime-validation.schemas.json",
  ]) {
    if (!packedPaths.has(requiredPath)) {
      throw new Error(`Packed artifact is missing ${requiredPath}.`);
    }
  }

  const artifactPath = join(temporaryRoot, artifact.filename);
  execFileSync(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", artifactPath],
    { cwd: temporaryRoot, stdio: "pipe" },
  );

  const smokeProgram = String.raw`
    import { existsSync, mkdirSync, writeFileSync } from "node:fs";
    import { createRequire } from "node:module";
    import { join } from "node:path";
    import {
      CodexAppServerClient,
      protocolValidationMetadata,
      resolveCodexBinary,
    } from "codex-app-server-client";

    if (protocolValidationMetadata.validatedClientRequests !== 125) {
      throw new Error("Installed runtime validation metadata is incomplete.");
    }
    const require = createRequire(import.meta.url);
    const runtimeSchema = require.resolve(
      "codex-app-server-client/schemas/runtime-validation.schemas.json",
    );
    if (!existsSync(runtimeSchema)) throw new Error("Installed runtime Schema is missing.");
    const binary = resolveCodexBinary();
    if (!existsSync(binary.executablePath)) throw new Error("Installed Codex binary is missing.");

    const codexHome = join(process.cwd(), "codex-home");
    mkdirSync(codexHome);
    writeFileSync(join(codexHome, "config.toml"), "[features]\\nplugins = false\\n");
    const client = new CodexAppServerClient({
      env: {
        CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG: "1",
        CODEX_HOME: codexHome,
        RUST_LOG: "warn",
      },
      protocolValidation: "strict",
      requestTimeoutMs: 10_000,
    });
    try {
      const initialized = await client.connect();
      if (!initialized.userAgent.includes("codex")) {
        throw new Error("Installed package did not initialize the real app-server.");
      }
    } finally {
      await client.close();
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", smokeProgram], {
    cwd: temporaryRoot,
    stdio: "pipe",
  });
  console.log(
    `Node ${process.versions.node} installed-package smoke passed (${artifact.filename}).`,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
