# Publishing Official Plugins

This registry accepts official plugin metadata through `entries/official/*.jsonc`.
The app repo owns official plugin asset builds and publishes assets to
deterministic Forgejo releases. This registry repo owns metadata sync, review,
signing, and site publication.

## Release Asset Requirements

Official plugin releases use one release tag per plugin version:

```text
official-plugin-assets-<plugin-id>-<version>
```

Default publishing is immutable: do not overwrite assets for an existing plugin
version. `--force-overwrite` in the app repo publish workflow is reserved for
exceptional repair work and must be followed by registry sync, generation,
signing, and validation before metadata is considered published.

Expected Forgejo release asset names:

```text
<plugin-id>-<version>.lapis-plugin
```

The `.lapis-plugin` bundle is a deterministic ZIP-compatible archive containing
`release.signed.json` and every installable plugin file. The signed release
manifest records each bundled file path, hash, and size. `manifest.json` and
`main.js` are required by app-side release packaging.

## Registry Update Flow

1. Build and package the plugin from `lapis-notes`.
2. Sign `release.json` as `release.signed.json` with the official plugin release
   key and package it with the plugin files as `<plugin-id>-<version>.lapis-plugin`.
3. Upload the single bundle to the deterministic Forgejo release in
   `lapis-notes/lapis`.
4. Sync registry entries from Forgejo:

```sh
pnpm registry:sync:forgejo -- --plugin-versions lapis-pdf@2026.6.6 --dry-run
pnpm registry:sync:forgejo -- --plugin-versions lapis-pdf@2026.6.6
pnpm registry:generate
pnpm registry:sign
pnpm registry:verify-signatures
pnpm registry:validate:remote
```

`registry:sync:forgejo -- --plugin-versions <plugin@version,...>` resolves each
pair to `official-plugin-assets-<plugin-id>-<version>`, fetches that Forgejo
release by tag, downloads the `.lapis-plugin` bundle, verifies the bundle hash
and size, verifies the embedded signed official release manifest, validates each
signed file against the bundled bytes, updates `entries/official/*.jsonc`, and
activates only plugins with verified bundles. Entries that still point at
historical multi-asset releases must be removed or republished as bundles before
publication. Bundled app-default functionality is intentionally outside this
installable registry flow.

Official entries may also include a mutable `readmeUrl` that points at an
HTTPS README, usually the package-local README in `lapis-notes`. The URL is
signed in registry metadata, but the README content is fetched by the registry
site build and published under `v1/readmes/<plugin-id>/` so clients render
registry-hosted markdown without depending on source host CORS. Documentation
edits require a site rebuild, but do not require metadata or release
republishing.
`registry:sync:forgejo` preserves curated `readmeUrl` values.
Published registry metadata and README artifacts are served with permissive CORS
headers from Cloudflare Pages middleware so browser and PWA clients can fetch
them directly.

The default `registry:validate` command checks schemas and local registry rules
without requiring the Forgejo assets to exist yet. The publish workflow uses
`registry:validate:remote`, which fetches each bundle, verifies the embedded
release signature and signed file hashes, and fails if pending plugin bundles
remain.
