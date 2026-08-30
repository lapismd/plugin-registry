# Lapis Plugin Registry

Static plugin registry metadata for Lapis Notes.

The V1 registry publishes inline-signed JSON metadata for official installable
plugins.
Generated files under `generated/v1/` are intended to be deployed as static
assets. Official plugins publish deterministic, per-package-version GitHub
release downloads from their owning repositories and npm packages for static
application composition.

## Commands

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
`registry.json`, registry-only Markdown, logos, and gallery assets without
changing `generated/v1` or its signatures. A banner keeps the local preview
distinct from signed production metadata. Point it at another checkout or port
when needed:

```sh
pnpm site:dev:source -- --source ../lapis-plugins-registry-media --port 4322
```

Each port uses an isolated temporary overlay, so a browser test server or a
second working-source preview cannot remove another preview's assets. The
helper binds to `127.0.0.1` by default so its generated media URLs and review
address use the same reachable host.

Gallery cards use an atomic responsive-image contract. Source metadata declares
one to five cards with 1200×800 preview and 2400×1600 full lossless-WebP paths,
plus source-only Storybook capture and colour-segmented headline and description
composition instructions. Published
detail metadata retains only each card's ID, alternative text, and complete
hashed `images.preview` and `images.full` references.

Registry signing uses protected CI secrets or a local key generated under
`~/.lapis/`:

```sh
pnpm registry:keygen

LAPIS_REGISTRY_KEY_ID=lapis-registry-2026-01 \
LAPIS_REGISTRY_PRIVATE_KEY_PEM_B64="$(base64 -i ~/.lapis/lapis-registry-private.pem | tr -d '\n')" \
pnpm registry:sign
```

Private keys must never be committed. The committed bootstrap metadata is signed
so verification can run in CI before production keys are installed.

## Layout

- `entries/**`: human-maintained JSONC source entries.
- `schemas/**`: strict JSON schemas for source and generated metadata.
- `generated/v1/**`: deterministic generated registry files with inline
  signatures plus matching signature sidecars.
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

New plugin sources own a validated `registry.json` beside their package
manifest. It supplies curated categories and short highlights plus safe relative
Overview and Changelog Markdown paths. The registry fetches those files from the
exact source commit, validates package/repository ownership, and mirrors them
under `v1/content/<plugin-id>/`. Signed detail metadata records each mirror and
source URL with its SHA-256, byte size, and `text/markdown` media type. The
public site and Lapis clients consume the same references. Legacy `readmeUrl`
and `readme` fields remain supported while older catalog entries migrate.

First-party packages keep end-user catalog copy in
`registry-content/overview.md`; package-manager installation and static
composition guidance remains in the package README. Registry compatibility
uses `web` and `desktop` as its only platform identifiers.

Source metadata is intentionally bounded: links must use HTTPS, Markdown paths
must remain inside the package, highlights are plain text, and content is valid
UTF-8 no larger than 256 KiB per file. Registry badges and verified-owner claims
remain curated in this repository rather than being accepted from plugin source.
Static Cloudflare Pages `_headers` rules add `Access-Control-Allow-Origin: *` to
published registry files, README artifacts, and optional statistics. Only the
anonymous `/download/*` redirect is handled by a Pages Function; ordinary
registry pages and assets remain static. See
[Anonymous plugin download analytics](docs/download-analytics.md) for metric,
privacy, mirroring, recovery, and rollout details.

Production deployment is manual-only during the first-publication gate. The
`Publish registry` workflow requires the protected `registry-production`
environment, the `FIRST_REGISTRY_RELEASE_APPROVED` repository variable, and the
exact `REGISTRY_DEPLOY_APPROVED` input. Deploy-on-merge may be enabled only after
the first cutover is explicitly accepted. Visual tests are intentionally not a
registry deployment gate.
