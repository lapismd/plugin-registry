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
```

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
