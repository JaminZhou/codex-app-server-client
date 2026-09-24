# Releases and candidate preparation

`0.1.0` was published on 2026-09-09; its [release record](./docs/releases/0.1.0.md) identifies the
source, immutable archive and verification scope. Do not republish this version.

The `0.2.2` package has been published as `latest`; its version-specific instructions below are
historical and must not be repeated. For a future candidate, first choose an unpublished exact
version and update its metadata and artifact paths. Preparation, PR creation and merge are distinct
from permission to publish. Query the exact registry version and retained publication evidence
before starting a candidate.

The first preview, `@jaminzhou/codex-app-server-client@0.1.0-preview.0`, was published on
2026-09-08 using `--tag next`. The registry also assigned `latest` to that preview; attempting to
remove `latest` returned HTTP 400. Neither alias makes this a stable release. Exact-version
registry installation and downloaded-archive integrity were verified with npm and pnpm.
This repository has no push-, tag-, or schedule-triggered publishing workflow. The optional
[manual trusted-publishing workflow](./docs/trusted-publishing.md) separates candidate preparation
from publication of an explicitly approved archive. Adding these workflow files alone does not
configure npm permissions or establish that any package has been published.

Published versions are immutable. The procedures below apply only to a newly selected, unpublished
version; they do not authorize or describe republishing an existing version. Local rebuilds of this
checkout are development artifacts, not previously published bytes.

## Version and support policy

- Client versions are independent of the Codex runtime version. This unreleased source checkout
  pins `@openai/codex@0.156.1`; published client `0.2.2` bundles `0.155.1`, `0.2.1` bundles
  `0.154.0`, and `0.1.0` bundles `0.153.4`. See [COMPATIBILITY.md](./COMPATIBILITY.md).
- Future previews use a new target version and increasing `preview.N` suffix. Record changes and migration notes.
  Pre-1.0 APIs and generated experimental protocol types may change; consumers should pin exact
  versions and keep their lockfiles.
- `0.2.2` is a published non-preview release, still a pre-1.0 API. Preview commands use `--tag next`;
  do not deliberately promote a preview to `latest`. Always read back all registry tags: the first
  publication demonstrated that `--tag next` is not a guarantee that `latest` will be absent.
  Never reuse a published name/version or publish a stable version merely to repair tag naming.
- A runtime update is a separate compatibility change, not an automatic consequence of a newer
  npm dist-tag. Update provenance, generated artifacts, and tests together.

## Historical 0.2.2 preparation record

The `0.2.2` package is already published as `latest`. This section records the checks and archive
layout used for that release; it is not an active candidate procedure. Do not rerun candidate or
publish steps for `0.2.2`. Future releases must first select a new, unpublished exact version and
update `package.json`, metadata and artifact paths.

The historical `0.2.2` archive was `artifacts/jaminzhou-codex-app-server-client-0.2.2.tgz`,
paired with `artifacts/release-evidence.json` containing source SHA, dirty-checkout flag, SHA-512
integrity, sizes, exact file list, Node version and completed consumer checks. Those artifacts and
the package version are immutable historical outputs, not a candidate to regenerate.

## Preparing a future candidate

Start from a reviewed, merged, clean release revision whose `package.json` has a newly selected,
unpublished exact version. Confirm the version is not present in the registry before preparing it.
Use Node.js 22+ and pnpm 11.7.0:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm compatibility:smoke
pnpm release:pack
```

The packed archive must pass both npm and pnpm consumer checks. Retain the exact archive and its
matching evidence; for approval, regenerate only from the final clean committed source and review
the archive contents, integrity, current-head CI, and provenance.

`release:pack` requires a non-preview `0.x.y` version with public npm `latest` metadata.
`preview:pack` requires `0.x.y-preview.N` with `next`; mismatched commands fail before packing.
Neither command publishes or changes registry tags. Both invoke `npm pack` (including the
`prepare` build), check the published-file allowlist, and test the exact archive in fresh npm and
pnpm projects with install scripts disabled. Consumers type-check root/protocol declarations with
`skipLibCheck: false`, load ESM/schema exports, and run the shipped examples and CLI input cases;
they do not authenticate with npm or start real OAuth or model sessions.

Stable outputs are `artifacts/jaminzhou-codex-app-server-client-VERSION.tgz` and
`artifacts/release-evidence.json`; previews produce a versioned preview tarball and
`preview-evidence.json`. Retain previous approved evidence and archives before preparing a new
candidate. Artifacts are git-ignored. Both consumers and staged evidence writes must succeed before
promotion; failures leave the previous verified pair untouched. During promotion, old evidence is
removed before replacing the archive and new evidence is installed last. An interruption can leave
no evidence file; then no candidate is selected, even if a tarball exists. Never pair a tarball with
older evidence. This is process-failure protection, not a claim of power-loss durability or support
for concurrent preparation in one checkout. Inspect the command's exit status and evidence
source/hash before selecting a candidate.

The normal CI runs installed npm consumers on Node.js 18 across Linux, macOS and Windows, plus a
pnpm 11 consumer on Linux with Node.js 22. Package checks cover mechanics and simulated model
workflows, not real account access, output quality or every architecture. Run `pnpm git:smoke` after
committing to verify the committed Git-install path; it does not test uncommitted files.

## Future publication gates

Preparation can be completed without registry permissions. Publishing a future candidate requires:

1. Jamin's explicit approval of the candidate version, exact tarball integrity, and intended tag
   (`latest` for a stable release, `next` only for a preview).
2. An npm account authorized for `@jaminzhou` and the package name; registry 404 alone does not
   prove name ownership or publish rights.
3. npm's required authentication/2FA or an approved, main-restricted trusted-publishing setup.
4. Passing current-commit CI, reviewed changes, and a clean source commit matching the evidence.

No account setup, token creation, login, registry write, or GitHub release is implied by running
the preparation commands.

For recurring releases, prefer [GitHub Actions with npm OIDC](./docs/trusted-publishing.md):
manually prepare a candidate, approve its version/source/integrity, then manually dispatch the
separate publish workflow. The publisher downloads those retained bytes; it never rebuilds.
The local CLI procedure below remains available and requires npm's interactive authentication.

Only after approval, from the checkout whose candidate has been verified:

```bash
# Historical example only; never reuse a published package version:
npm publish /absolute/path/to/approved-candidate.tgz --tag latest --access public --registry https://registry.npmjs.org/ --ignore-scripts
```

Publish the inspected tarball, not a freshly rebuilt directory. Then read back the registry version,
dist-tag and `dist.integrity`, compare them with the saved evidence, install that exact registry
version into a new consumer, and repeat the examples. Record publication status separately from
the immutable archive. The packed README uses time-neutral exact-version guidance so publishing
does not require replacing the already-verified bytes. If the publish response is uncertain,
query the version before retrying.

The [0.2.2 release record](./docs/releases/0.2.2.md), [API comparison and migration notes](./docs/api-diff-0.2.0.md),
and [0.1.0 acceptance checklist](./docs/release-readiness.md) are historical records. For a future
version, prepare a new exact candidate, retain its reviewed bytes, and obtain explicit publication
approval. Passing tests does not authorize publication or model usage.

See npm's [package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/) and
[publish command](https://docs.npmjs.com/cli/v11/commands/npm-publish/) documentation.
