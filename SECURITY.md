# Security policy

## Supported versions

The published preview line is `0.1.0-preview.x`, currently `0.1.0-preview.0`.
Security fixes are developed on `main` and require a separately reviewed and authorized release;
updating `main` alone does not fix an already installed package. Consumers should pin a reviewed
version, retain their lockfile, and update when a security-fix release is announced. Older preview
versions may be superseded rather than maintained as separate backport branches.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Please do not disclose a
suspected vulnerability in a public issue, discussion, or pull request.

Include the affected version or commit, reproduction steps, impact, and any suggested mitigation.
Reports involving credentials should use revoked test credentials only; never include active Codex,
OpenAI, GitHub, or third-party secrets.
