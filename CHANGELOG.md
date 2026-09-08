# Changelog

## 0.1.0 (candidate — not yet published)

- Deterministic real-runtime regression coverage for concurrent thread streams, approval-policy
  inheritance, interruption followed by another turn, and managed-process death/recovery.
- Document the published preview and explicit acceptance gates for a future `0.1.0` release.
- Prepare the first non-preview candidate with explicit `release:pack` verification and intended
  npm `latest` tag. This is still a pre-1.0 API, not a 1.0 stability guarantee.
- No public API, protocol, dependency, or transport behavior changes from `0.1.0-preview.0`;
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
