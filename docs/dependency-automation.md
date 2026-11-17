# Registry dependency maintenance

This repository is a private Node application. It deploys signed registry data
and a static site; it does not publish an npm package or run a Changesets version
recipe. Dependency intake must preserve that authority split. The existing
registry App remains dedicated to registry preparation/signing/publication; it
is not a replacement for the coordinator notification credential.

## Source-owned intake contract

`pnpm dependency:check` runs in normal `pnpm check` and the hosted Checks workflow,
independently of bot specification exemptions. It requires the private single
root, pinned pnpm, retained signature verification and registry generation. The
only qualified first-party input is the API runtime schema on its existing
`^0.1` patch family, with minimum0.1.2. New owners, a 0.x minor migration,
prerelease/catalog/local references, Deno commands or an npm version/publication
recipe require source review and new qualification. This guard grants no writer,
signing, release, deployment or baseline authority.

The existing registry and browser tests validate the API-owned public schema.
The historical API migration record describes its reviewed minimum; manifests
and the frozen registry lockfile own current resolved coordinates. This source
has no canonical dependency version slots or public npm owner to regenerate. A
compatible private dependency update has no package-version or Changeset intent.
The shared native preparer must retain that no-version result.

## Existing publication and rollback

Verified plugin release hints create bounded submission PRs. Qualified registry
preparation coalesces approved requests and retains an immutable signed
candidate; the separate writer reuses that artifact. Checks, public signature
verification, source/archive identity, protected deployment and the existing
production approval variable remain gates. An unchanged queue must not create
another registry release, PR or deployment request. See
[publishing official plugins](publishing-official-plugins.md) and
[publication efficiency](publication-efficiency-2026-11-15.md).

Completion wake-ups must use the same reviewed immutable coordinator pin for
implementation and policy, observe exact registered Checks/Publish registry
identities, and execute no candidate checkout, artifacts or caches. Registration,
source credentials and hosted callback proof remain separate acceptance steps.
Until qualified, ordinary authoritative coordinator scans remain the recovery
route. No source App secret is retrieved, copied or rotated by this change.

Rollback disables the source callback and returns only this repository’s
coordinator entry to its prior phase. Preserve signed artifacts, queued requests,
manual repairs and durable operations; inspect uncertain writes before retrying.
Tracker [65](https://github.com/lapismd/dependency-automation/issues/65) owns
activation and end-to-end acceptance.
