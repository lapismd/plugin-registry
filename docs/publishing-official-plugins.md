# Publishing Official Plugins

This registry accepts official plugin metadata through
`entries/official/*.jsonc`. Each plugin source repository owns its npm package,
deterministic archive, release signature, and GitHub release. This repository
owns release verification, curated metadata review, registry signing, and site
publication.

## Release Asset Requirements

Official plugins use one package-scoped tag per version:

```text
<package-directory>@<version>
```

The GitHub release must contain exactly named assets:

```text
<plugin-id>-<version>.lapis-plugin
<plugin-id>-<version>.lapis-plugin.sha256
```

Publishing is immutable. Never replace assets for an existing plugin version;
publish a new patch version instead. The `.lapis-plugin` file is a deterministic
ZIP-compatible archive containing `release.signed.json`, `manifest.json`,
`main.mjs`, `styles.css`, workers, and traced assets. The embedded signed release
manifest records each installable path, SHA-256, and size and binds the archive
to the npm package name and source commit.

## Registry Update Flow

1. Publish the verified npm package.
2. Create the package-scoped GitHub release and attach the archive and checksum.
3. Send a `repository_dispatch` request with action `plugin_release` and this
   exact payload:

```json
{
  "repository": "lapismd/lapis-plugins",
  "package_name": "@lapis-notes/graph",
  "plugin_id": "lapis-graph",
  "version": "0.1.0",
  "release_tag": "graph@0.1.0",
  "asset_name": "lapis-graph-0.1.0.lapis-plugin",
  "source_commit": "0123456789abcdef0123456789abcdef01234567"
}
```

4. The dispatch workflow downloads both assets and rejects malformed payloads,
   missing or extra signed files, unsafe paths, coordinate mismatches, invalid
   signatures, checksums, sizes, or runtime descriptors.
5. It updates the source entry without removing prior versions, regenerates and
   signs V1 metadata, runs remote validation and the Astro site tests, then opens
   or updates `automation/plugin-<plugin-id>-<version>`.
6. A maintainer reviews and merges the registry pull request. Checks validate
   every referenced remote bundle; visual tests are not required and do not
   block merging or deployment.

The workflow uses a narrowly scoped GitHub App installed only on the plugin and
registry repositories. It needs repository contents read/write for the release
and automation branch, pull-request write access in the registry, and access to
send/receive repository dispatch events. Store its ID and private key as
`LAPIS_REGISTRY_APP_ID` and `LAPIS_REGISTRY_APP_PRIVATE_KEY` secrets.

## README Mirroring and CORS

The sync records the package-local README at the verified source commit. The
site build mirrors that content under `v1/readmes/<plugin-id>/`, allowing clients
to render registry-hosted Markdown without depending on source-host CORS.
Documentation updates require a new registry/site change but no plugin binary
republishing. Cloudflare Pages middleware serves registry metadata and README
artifacts with permissive CORS headers.

## Migration Source

The former Forgejo repository remains a read-only migration remote. Existing
catalog entries and versions remain available until verified GitHub releases
supersede them. For an audited migration refresh only:

```sh
pnpm registry:sync:forgejo:migration -- --plugin-versions lapis-graph@2026.6.6 --dry-run
```

The default `registry:validate` command checks schemas and local rules. Pull
requests and the manual production workflow run `registry:validate:remote`,
which downloads every active archive and verifies its embedded official release
signature and signed files.
