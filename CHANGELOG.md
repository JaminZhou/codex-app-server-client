# Changelog

## Unreleased

- Bound retries for temporary-directory cleanup in npm/pnpm and Git installed-consumer smokes;
  retain both errors when the consumer and cleanup fail, and report success only after cleanup.
- Add a Windows file-sharing regression fixture and the historical `0.1.0` release record.
- No client runtime, protocol or dependency change; these maintenance changes are not in the
  immutable npm `0.1.0` archive and do not require republishing it.

## 0.1.0 (2026-09-09)

Published with `latest` pointing to `0.1.0`; see the [release record](./docs/releases/0.1.0.md).

- Deterministic real-runtime regression coverage for concurrent thread streams, approval-policy
  inheritance, interruption followed by another turn, and managed-process death/recovery.
- Document the published preview and explicit acceptance gates for a future `0.1.0` release.
- Prepare the first non-preview candidate with explicit `release:pack` verification and intended
  npm `latest` tag. This is still a pre-1.0 API, not a 1.0 stability guarantee.
- Raise the Vitest development dependency floor to `4.1.11` and update its lockfile graph,
  including `@vitest/mocker`, to address the redirect-mock path traversal/arbitrary-read advisory.
- No public API, protocol, runtime dependency, or transport behavior changes from `0.1.0-preview.0`;
  default initialize client-info version becomes `0.1.0`. See [API comparison](./docs/api-diff-0.1.0.md).

## 0.1.0-preview.0 (2026-09-08)

- First npm-preview preparation for the scoped, unofficial Node.js ESM client.
- Runnable streaming, command-decline, and interrupt/restart/resume examples. Default execution uses
  a real pinned runtime with a temporary home and loopback mock provider, with no model usage.
- Task-oriented onboarding, authentication/usage boundaries, troubleshooting, and a separate API guide.
- Clean npm and pnpm tarball verification with install scripts disabled and strict declaration checks.
- Explicit Node.js type reference in bundled declarations for pnpm's isolated dependency layout.
- Candidate archive, SHA-512 evidence, and a manual `next` release procedure. The exact archive
  was published and verified through fresh npm/pnpm registry consumers. The registry also assigned
  `latest` to this preview; it does not represent a stable-release promotion.

Runtime remains pinned to Codex `0.153.4`; this batch adds no protocol methods. Existing Git
consumers retain the same API and ESM imports. The default initialize client-info version now tracks
the package version rather than reporting `0.0.0`.
