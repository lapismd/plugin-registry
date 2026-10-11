# Lapis Plugin Registry

Static plugin registry metadata for Lapis Notes.

The V2 registry publishes inline-signed JSON metadata using Community's shared
presentation schema. `generated/v2/` is the current catalog;
`generated/v1/` remains a signed archive. Official plugins publish deterministic,
per-package-version GitHub archives and npm packages for static composition.

The Astro site renders descriptions, highlights, documentation links, themed
logos/banner/overview/gallery images and structured per-version changelogs.
V2 omits README and Markdown-reference fields. Immutable artifact hashes and
compatibility data remain attached to each version; listing compatibility
comes from the latest release. Nostr deployment remains deferred.

`plugin_release` dispatches verify signatures, artifact hashes and pinned source
metadata before opening idempotent registry PRs. Metadata-only dispatches retain
release artifacts and version history. Source schema V1 remains readable for
older independent plugins; publication normalizes to V2. Structured notes use
the exact Changesets section or a validated
`registry.json.releases[version].changelog` override.

The first signed V2 cutover requires approval. After
`STATIC_REGISTRY_V2_DEPLOY_APPROVED` is enabled, validated merges to `main` deploy
the Astro site and signed catalog. Signing remains a protected, reviewable step
using the existing registry and release trust roots.

## Commands

The initial rollout requires a Community release that exports
`@lapismd/lapis-community/registry/schema`. Before that publication, local
acceptance uses a built Community tarball installed temporarily in the isolated
registry workspace. Keep the tracked dependency on its npm semver range;
refresh the registry lockfile from npm once that release is available. A
temporary tarball install does not qualify the production frozen-install gate.

```sh
pnpm install
pnpm check
pnpm registry:validate
pnpm registry:sync:github -- --event-path /path/to/repository-dispatch.json --dry-run
pnpm registry:preview:release-plan -- --release-plan ../lapis-plugins/.release/release-plan.json --public-key ../lapis-plugins/.release/plugin-release-public.pem --output tmp/registry-preview.json
pnpm registry:generate
pnpm registry:verify-signatures
pnpm stats:validate
pnpm site:dev:source
pnpm test:browser
```

`site:dev:source` starts the catalog with an unsigned overlay from the sibling
`../lapis-plugins` checkout. It reads current package manifests,
`registry.json`, presentation fields, release notes, logos, and gallery assets without
changing the signed generated catalog or its signatures. A banner keeps the local preview
distinct from signed production metadata. Point it at another checkout or port
when needed:

```sh
pnpm site:dev:source -- --source ../lapis-plugins-registry-media --port 4322
```

Each port uses an isolated temporary overlay, so a browser test server or a
second working-source preview cannot remove another preview's assets. The
helper binds to `127.0.0.1` by default so its generated media URLs and review
address use the same reachable host.

Source packages absent from the curated catalog appear as pending entries only
in this local overlay. Their bundles cannot be installed. This includes
Community and Slides until their first approved releases are indexed.

Gallery cards use an atomic responsive-image contract. Source metadata declares
one to five cards with optional 1200×800 preview and 2400×1600 full/light/dark lossless-WebP paths,
plus source-only Storybook capture and colour-segmented headline and description
composition instructions. Published
detail metadata retains only each card's ID, alternative text, and authored
hashed image variants. Display fallbacks preserve missing authored variants.

Registry signing uses protected CI secrets or a local key generated under
`~/.lapis/`:

```sh
pnpm registry:keygen

LAPIS_REGISTRY_KEY_ID=lapis-registry-2026-01 \
LAPIS_REGISTRY_PRIVATE_KEY_PEM_B64="$(base64 -i ~/.lapis/lapis-registry-private.pem | tr -d '\n')" \
pnpm registry:sign
```

Private keys must never be committed. V2 metadata must be signed with the existing registry key before cutover.
Tests generate isolated ephemeral keys and output directories, separate from
production build output.

## Layout

- `entries/**`: human-maintained JSONC source entries.
- `schemas/**`: strict JSON schemas for source and generated metadata.
- `generated/v2/**`: deterministic current registry files with inline
  signatures plus matching signature sidecars.
- `generated/v1/**`: retained archive for older clients.
- `stats/daily/**`: immutable UTC download aggregates once production tracking
  is enabled; `stats/summary.json` is rebuilt only from these files.
- `scripts/**`: validation, generation, signing, and verification tooling.

Official plugin asset builds and release signing live in each plugin source
repository. A successful npm and GitHub release sends a `plugin_release`
repository dispatch. The registry verifies the GitHub checksum, archive,
embedded release signature, source coordinates, signed file list, and runtime
descriptor plus source-owned metadata before an idempotent automation branch
and pull request are created. A `plugin_metadata` dispatch accepts repository,
package, plugin, and source-commit coordinates and refreshes documentation
without changing any catalog release version or bundle.
Existing catalog versions use immutable assets from the public
`lapis-notes/releases` GitHub repository. New package-scoped plugin releases are
published from `lapismd/lapis-plugins` and indexed through the verified GitHub
dispatch workflow.

New plugin sources own a validated V2 `registry.json` beside their package
manifest. It supplies categories, plain-text highlights, documentation links,
source-owned image paths and optional structured-note overrides. The registry
fetches metadata, `CHANGELOG.md` and assets at the exact source commit, verifies
ownership, and mirrors hashed image variants under `v2/assets/<plugin-id>/`.
Historical V1 Markdown references remain in the archive.

Links use HTTPS and asset paths stay within the package. Media has bounded byte
sizes and validated dimensions; gallery paths retain strict Storybook capture
contracts. Badges and verified-owner claims stay curator-owned. Platform labels
are preserved in metadata; runtime compatibility still checks supported hosts.

Cloudflare Pages CORS headers cover both registry versions and statistics.
Only anonymous `/download/*` redirects use a Pages Function; catalog pages and
assets stay static. See [download analytics](docs/download-analytics.md) for
metric, privacy, mirroring and recovery details.

The production workflow requires the protected `registry-production`
environment and the V2 cutover variable. It verifies committed signatures and
production assets before deployment. Visual baseline updates remain separately
approved.

Source packages marked `private: true` are parked and excluded from the local
registry, including curated entries. Community is parked in the first-party
source repository for this release; Slides remains available for preview.
