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
  "version": "0.1.2",
  "release_tag": "graph@0.1.2",
  "asset_name": "lapis-graph-0.1.2.lapis-plugin",
  "source_commit": "0123456789abcdef0123456789abcdef01234567"
}
```

4. The dispatch workflow downloads both assets and rejects malformed payloads,
   missing or extra signed files, unsafe paths, coordinate mismatches, invalid
   signatures, checksums, sizes, or runtime descriptors.
5. It updates the source entry without removing prior versions, regenerates and
   signs V2 metadata, runs remote validation and the Astro site tests, then opens
   or updates `automation/plugin-<plugin-id>-<version>`.
6. A maintainer reviews and merges the registry pull request. Checks validate
   every referenced remote bundle. The approved V2 cutover enables deployment
   after validated merges; human visual review remains separate from functional
   and accessibility checks.

The workflow uses a narrowly scoped GitHub App installed only on the plugin and
registry repositories. It needs repository contents read/write for the release
and automation branch, pull-request write access in the registry, and access to
send/receive repository dispatch events. Store its client ID and private key as
`LAPIS_REGISTRY_APP_CLIENT_ID` and `LAPIS_REGISTRY_APP_PRIVATE_KEY` secrets.

## Presentation Metadata and CORS

The source owns a V2 `registry.json` with categories, highlights, documentation
links, optional logo/banner/overview/gallery variants, and optional structured
release-note overrides. The registry reads these files and Changesets notes at
the verified source commit and mirrors hashed images under `v2/assets/`.
Clients consume inline structured metadata and per-version changelogs. The V1
archive retains historical Markdown references for older clients.

A `plugin_metadata` dispatch updates presentation fields while preserving every
release version and artifact. It requires no binary publication. Static Pages
CORS headers cover both registry versions and their assets.

Both release and metadata syncs extract the exact `CHANGELOG.md` section for
each retained release version, even when the source manifest has advanced to
an unpublished version. Per-version structured overrides apply only to that
version. Missing sections preserve existing verified notes; newer notes are
never assigned to older releases.

The site retains every indexed version at `/plugins/<id>/versions/<version>/`.
The version selector and Releases links select its compatibility, date, notes,
bundle size and immutable archive. Install in Lapis opens
`lapis://plugins?id=<id>&version=<version>` in the registered app, selecting its
verified plugin page without automatic installation or a caller-provided archive
or trust root. The receiving app requires the disposable `plugins` action and
version navigation. More actions also offers the registered `web+lapis` handler
for an installed Web app when the release supports Web. Installation help and archive downloads remain under More
actions for the existing verified file installer. Pending bundles and inactive
plugins remain non-installable. Presentation fields are shared catalog metadata,
not a historical snapshot of each release's screenshots or description.

The default `registry:validate` command checks schemas and local rules. Pull
requests and the manual production workflow run `registry:validate:remote`,
which downloads every active archive and verifies its embedded official release
signature and signed files.

## Registry presentation

The header Manifest link opens a full-page syntax-highlighted view of the same
registry JSON served by the raw endpoint. The footer shows the source snapshot's
commit timestamp in UTC, independently of reproducible signed-metadata timestamps.
Builds without Git metadata may supply `LAPIS_REGISTRY_UPDATED_AT` explicitly.

Release selection retains the native keyboard-accessible dropdown and a shareable
page for every curated version. Site acceptance follows curated latest versions
while verifying older pages and their installation coordinates.

Download statistics remain hidden until a current, validated summary is available.
The author row then links its compact lifetime count to the statistics section;
counts remain approximate tracked redirect requests. Missing, stale or malformed
summaries never reveal either surface or invent a zero.
