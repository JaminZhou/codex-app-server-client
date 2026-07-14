# Contributing

## Development checks

Use Node.js 22 and the pnpm version declared in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` verifies generated protocol artifacts before running TypeScript checks, unit and real app-server integration tests, and the package build.

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
