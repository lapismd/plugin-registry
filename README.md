# Lapis Plugin Registry

Static plugin registry metadata for Lapis Notes.

The V1 registry publishes inline-signed JSON metadata for official installable
plugins.
Generated files under `generated/v1/` are intended to be deployed as static
assets, initially through Cloudflare Pages.

## Commands

```sh
pnpm install
pnpm check
pnpm registry:validate
pnpm registry:generate
pnpm registry:verify-signatures
```

Signing requires protected CI secrets:

```sh
LAPIS_REGISTRY_KEY_ID=lapis-registry-2026-01 \
LAPIS_REGISTRY_PRIVATE_KEY_PEM="$(cat private-key.pem)" \
pnpm registry:sign
```

Private keys must never be committed. The committed bootstrap metadata is signed
so verification can run in CI before production keys are installed.

## Layout

- `entries/**`: human-maintained JSONC source entries.
- `schemas/**`: strict JSON schemas for source and generated metadata.
- `generated/v1/**`: deterministic generated registry files with inline
  signatures plus matching signature sidecars.
- `scripts/**`: validation, generation, signing, and verification tooling.

The first real plugin entry is `lapis-docs`. App-side installation,
provenance state, and migration from the bundled `docs` plugin live in the
`lapis-notes` repository.
