# Contributing

## Development checks

Use Node.js 22 and the pnpm version declared in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` verifies generated protocol artifacts before running TypeScript checks, unit and real
app-server integration tests, and the package build. CI then packs the npm artifact, installs it in
an empty temporary project, type-checks its public protocol declarations with dependency checks
enabled, verifies its exported Schema/CLI/provenance files, and initializes a strictly validated
real app-server on the declared minimum Node.js 18 runtime.

The installed-package smoke runs on Linux, macOS, and Windows, so the public package exports and the
platform-specific bundled Codex CLI are exercised on each supported operating system before a pull
request is merged. The protected `check` context aggregates all platform jobs and succeeds only
when all have passed.

A separate scheduled workflow runs `pnpm protocol:latest-check` against npm's latest stable Codex
release. It always verifies that the pinned public Rust tag still resolves to the recorded commit
and method map. It also fails when the pinned runtime is behind and reports whether the newer
release changes the generated public protocol, without making a time-dependent registry lookup part
of the required pull-request check.

A weekly compatibility workflow reads `compatibility-matrix.json`, installs each exact Codex CLI
version in isolation, and exercises initialization, strict protocol validation, model and thread
listing, thread creation/read, and thread-goal access against the real app-server on Node.js 18.
The regular `pnpm check` validates that the ordered matrix contains at least two stable releases and
ends at the pinned runtime without downloading historical packages.

Run the full matrix locally with `pnpm compatibility:smoke`; it builds the client and downloads the
exact historical CLI packages declared in the matrix.

The real-turn integration test never calls an external model service. It starts the pinned
app-server with a temporary `CODEX_HOME` configured to use a loopback mock Responses provider.

## Updating the Codex protocol

1. Change `@openai/codex` to an exact version in `package.json`.
2. Install dependencies and update `pnpm-lock.yaml`.
3. Fetch the matching public `rust-vX.Y.Z` tag from `openai/codex`.
4. Extract the exact tag's `codex-rs/app-server-protocol/src/protocol/common.rs`.
5. Refresh the public client-method and server-request maps:

```bash
node scripts/extract-method-map.mjs \
  --source /path/to/common.rs \
  --version X.Y.Z \
  --tag rust-vX.Y.Z \
  --commit FULL_GIT_COMMIT
```

6. Run `pnpm protocol:generate`.
7. Review generated protocol and Schema changes, update compatibility notes, then run `pnpm check`.

The generator rejects non-exact CLI versions, mismatched method-map versions, missing methods,
extra methods, missing generated response types, and missing server-response Schema. It also records
client response types for which the upstream generator publishes no JSON Schema.

`@openai/codex` is exempt from the repository's minimum-release-age gate because protocol updates intentionally track current Codex releases. It remains exact-version pinned and must match a public Rust tag, commit, lockfile integrity, and regenerated protocol artifacts.

## Implementation boundaries

Use public documentation, generated bindings and schemas, the open-source Codex repository, and official open-source SDKs. Do not contribute decompiled or extracted private Codex Desktop code.

## Commit style

Use a lowercase conventional prefix such as `feat:`, `fix:`, `docs:`, `test:`, or `chore:` followed by a concise summary.
