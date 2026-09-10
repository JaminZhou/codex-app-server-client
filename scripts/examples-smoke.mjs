import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runExamples } from "./run-examples.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
runExamples(resolve(root, "examples"), root);
