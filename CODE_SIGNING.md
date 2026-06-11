# Code Signing Policy

Nimbus Windows builds are intended to be code-signed via the
[SignPath Foundation](https://signpath.org/) free code-signing program for
open-source projects.

## Build & signing pipeline

- **Source of truth:** this public repository (`tumasov69/nimbus`), MIT-licensed.
- **Builds** are produced exclusively by GitHub Actions
  (`.github/workflows/release.yml`) from a tagged commit — never on a developer
  machine for signed releases. This gives a verifiable link between the public
  source and the published binary.
- **Signing** is performed by SignPath.io after the CI build, using a
  certificate issued by the SignPath Foundation. The signing private key is
  generated and stored in SignPath's HSM and is never exposed.
- The **updater manifest** (`latest.json`) is additionally signed with minisign;
  the public key is committed in `src-tauri/tauri.conf.json`, the private key is
  a GitHub Actions secret only.

## Roles

- **Author / Maintainer:** @tumasov69 — writes code, triggers releases by tag.
- **Reviewer / Approver:** @tumasov69 — reviews the release before approving the
  signing request in SignPath.

## Security

- Multi-factor authentication is enabled on the GitHub repository and on the
  SignPath account.
- No signing keys, tokens or passwords are stored in this repository; they exist
  only as GitHub Actions secrets and in SignPath's HSM.
- Report security issues privately to the maintainer.
