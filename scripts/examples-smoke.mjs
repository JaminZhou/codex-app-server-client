import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const example of ["stream", "approvals", "interrupt-resume"]) {
  execFileSync(process.execPath, [resolve(root, "examples", `${example}.mjs`)], {
    cwd: root, stdio: "inherit", timeout: 60_000,
  });
}
console.log("All runnable examples passed against the real runtime and local mock provider.");
