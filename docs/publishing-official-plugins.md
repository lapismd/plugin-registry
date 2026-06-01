# Publishing Official Plugins

This registry accepts official plugin metadata through `entries/official/*.jsonc`.
The app repo owns official plugin asset builds and publishes immutable assets to
Forgejo releases. This registry repo owns metadata sync, review, signing, and
site publication.

## Release Asset Requirements

Official plugin releases are immutable. Do not overwrite assets for an existing
plugin version.

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
3. Upload immutable assets to a Forgejo release in `lapis-notes/lapis`.
4. Sync registry entries from Forgejo:

```sh
pnpm registry:sync:forgejo -- --dry-run
pnpm registry:sync:forgejo
pnpm registry:generate
pnpm registry:sign
pnpm registry:verify-signatures
pnpm registry:validate:remote
```

`registry:sync:forgejo` discovers assets named
`<plugin-id>-<version>-release.signed.json`, verifies signed official release
manifests, fetches release files, computes hashes and sizes, updates
`entries/official/*.jsonc`, and activates only plugins with verified remote
assets. Bundled app-default functionality is intentionally outside this
installable registry flow.

Official entries may also include a mutable `readmeUrl` that points at an
HTTPS README, usually the package-local README in `lapis-notes`. The URL is
signed in registry metadata, but the README content is fetched and rendered by
clients at view time so documentation edits do not require a registry republish.
`registry:sync:forgejo` preserves curated `readmeUrl` values.

The default `registry:validate` command allows pending entries for local
bootstrap work. The publish workflow uses `registry:validate:remote`, which
fails if pending release manifests remain.
