# Lapis Plugin Registry

Static plugin registry metadata for Lapis Notes.

The V1 registry publishes inline-signed JSON metadata for official installable
plugins.
Generated files under `generated/v1/` are intended to be deployed as static
assets, while immutable official plugin release assets are published by the
`lapis-notes` app repo as Forgejo release downloads.

## Commands

```sh
pnpm install
pnpm check
pnpm registry:validate
pnpm registry:sync:forgejo -- --dry-run
pnpm registry:generate
pnpm registry:verify-signatures
```

Registry signing uses protected CI secrets or a local key generated under
`~/.lapis/`:

```sh
pnpm registry:keygen

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

Official plugin asset builds, release signing, and Forgejo upload live in the
`lapis-notes` repository. This registry syncs those published releases into
reviewed metadata with `pnpm registry:sync:forgejo`.
