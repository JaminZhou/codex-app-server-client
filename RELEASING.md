# Preview releases

The first preview, `@jaminzhou/codex-app-server-client@0.1.0-preview.0`, was published on
2026-09-08 using `--tag next`. The registry also assigned `latest` to that preview; attempting to
remove `latest` returned HTTP 400. Neither alias makes this a stable release. Exact-version
registry installation and downloaded-archive integrity were verified with npm and pnpm.
This repository has no automatic publishing workflow.

The published `.0` archive is immutable. The commands below describe preparation/publication gates,
not permission to republish `.0`. Choose a new, explicitly approved version before any future
publication; local rebuilds of this checkout are development artifacts, not the published bytes.

## Version and support policy

- Client versions are independent of the Codex runtime version. This candidate pins
  `@openai/codex@0.153.4`; see [COMPATIBILITY.md](./COMPATIBILITY.md).
- Iterate previews as `0.1.0-preview.1`, `0.1.0-preview.2`, etc. Record changes and migration notes.
  Pre-1.0 APIs and generated experimental protocol types may change; consumers should pin exact
  versions and keep their lockfiles.
- Reserve `0.1.0` for a separately approved non-preview release. Preview commands use `--tag next`;
  do not deliberately promote a preview to `latest`. Always read back all registry tags: the first
  publication demonstrated that `--tag next` is not a guarantee that `latest` will be absent.
  Never reuse a published name/version or publish a stable version merely to repair tag naming.
- A runtime update is a separate compatibility change, not an automatic consequence of a newer
  npm dist-tag. Update provenance, generated artifacts, and tests together.

## Build a concrete candidate (no publication)

Use a reviewed checkout, Node.js 22+, and pnpm 11.7.0:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm compatibility:smoke
pnpm preview:pack
```

`preview:pack` invokes `npm pack` (including the `prepare` build), checks the published file
allowlist, and tests that exact archive in fresh npm and pnpm projects with install scripts
disabled. Both consumers type-check the root/protocol declarations with `skipLibCheck: false`,
load the ESM and schema exports, and execute all three shipped examples against the real pinned
runtime and a loopback mock provider. It does not authenticate with npm, start a real model
session, or publish.

Outputs:

- `artifacts/jaminzhou-codex-app-server-client-0.1.0-preview.0.tgz`
- `artifacts/preview-evidence.json`: source SHA, dirty-checkout flag, SHA-512 integrity, sizes,
  exact file list, Node version, and completed consumer checks.

Artifacts are git-ignored. Successful preparation replaces the local candidate and evidence only
after both consumers pass; a failed run leaves the previous verified pair untouched. Inspect the
command's exit status and the evidence's source commit before selecting a candidate.
For release approval, regenerate from a clean committed checkout so `sourceDirty` is `false`,
review the archive's contents/integrity and PR CI, and retain those exact bytes. Package consumers
get built ESM/declarations, schemas, examples, docs, and licenses, not source build tooling.

The normal CI runs installed npm consumers on Node.js 18 across Linux, macOS, and Windows, plus a
pnpm 11 consumer on Linux with Node.js 22. `preview:pack` verifies both installers locally. These checks verify
package mechanics and simulated model workflows, not real account access, model output quality,
or all architecture combinations. Run `pnpm git:smoke` after committing to verify the committed
Git-install path; it does not test uncommitted files.

## Publication gates

Preparation can be completed without registry permissions. Publication still requires:

1. Jamin's explicit approval of the candidate version, exact tarball, and `next` release.
2. An npm account authorized for `@jaminzhou` and the package name; registry 404 alone does not
   prove name ownership or publish rights.
3. npm's required authentication/2FA or an approved trusted-publishing setup.
4. Passing current-commit CI, reviewed changes, and a clean source commit matching the evidence.

No account setup, token creation, login, registry write, or GitHub release is implied by running
the preparation commands.

Only after approval, from the checkout whose candidate has been verified:

```bash
# Replace with the retained archive for a NEW approved preview version, never the published .0:
npm publish /absolute/path/to/approved-new-preview.tgz --tag next --access public --registry https://registry.npmjs.org/ --ignore-scripts
```

Publish the inspected tarball, not a freshly rebuilt directory. Then read back the registry version,
dist-tag and `dist.integrity`, compare them with the saved evidence, install that exact registry
version into a new consumer, and repeat the examples. Update the README's publication status only
after verifying success. If the publish response is uncertain, query the version before retrying.

For the first non-preview `0.1.0`, complete [release acceptance](./docs/release-readiness.md),
review the version bump and `publishConfig.tag` change to `latest`, retain the exact reviewed
candidate, and obtain explicit publication approval. Passing tests does not authorize that write.

See npm's [package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/) and
[publish command](https://docs.npmjs.com/cli/v11/commands/npm-publish/) documentation.
