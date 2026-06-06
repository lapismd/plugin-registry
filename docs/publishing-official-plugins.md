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
<plugin-id>-<version>-release.json
<plugin-id>-<version>-release.signed.json
<plugin-id>-<version>-artifact.json
<plugin-id>-<version>.zip
<plugin-id>-<version>-file-<base64url-path>
```

The signed release manifest lists the installable file URLs, hashes, and sizes.
`manifest.json` and `main.js` are required by app-side release packaging.

## Registry Update Flow

1. Build and package the plugin from `lapis-notes`.
2. Sign `release.json` as `release.signed.json` with the official plugin release
   key.
3. Upload assets to the deterministic Forgejo release in `lapis-notes/lapis`.
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
release by tag, verifies the signed official release manifest, fetches release
files, computes hashes and sizes, updates `entries/official/*.jsonc`, and
activates only plugins with verified remote assets. Existing registry entries
that point at historical shared batch releases stay valid and are not migrated.
Bundled app-default functionality is intentionally outside this installable
registry flow.

Legacy compatibility remains available: `--release-tag <tag>` restricts sync to
one historical shared release, and running without `--plugin-versions` or
`--release-tag` scans recent Forgejo releases for the latest compatible asset.
Use deterministic `--plugin-versions` for normal new official publishes.

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

The default `registry:validate` command allows pending entries for local
bootstrap work. The publish workflow uses `registry:validate:remote`, which
fails if pending release manifests remain.
