# Publishing Official Plugins

This registry accepts verified requests through one-file PRs under
`submissions/<plugin-id>/<version>.jsonc`. Maintainers merge submissions into a
queue, then review one **Publish registry updates** PR containing the resulting
`entries/official/*.jsonc`, generated catalog and signatures.
Each plugin source repository owns its npm package,
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
5. It opens or updates `automation/plugin-<plugin-id>-<version>` with exactly one
   versioned request file. Its description includes the verified source and image
   previews. This PR contains no generated catalog, image copies or signatures.
6. A maintainer merges the submission. This makes the request ready for
   publication; the live catalog remains unchanged. Different plugins and
   different versions use different files, so their PRs can merge independently.
7. **Prepare registry publication** replays the merged requests through the same
   archive and source verifier. It retains indexed versions, mirrors the declared
   media, generates and signs the catalog, and removes the consumed queue files
   in one bot-managed **Publish registry updates** PR. Further submissions update
   that same open PR. Human commits, unexpected files, competing curated entry
   changes on `main` or changed request identity
   stop its update for reconciliation.
8. A maintainer reviews and merges the publication PR. The existing production
   approval variable and protected deployment environment still control the
   deployment. Checks validate every referenced remote bundle, signatures, site,
   interactions and accessibility. Human visual review remains separate.

The workflow uses a narrowly scoped GitHub App installed only on the plugin and
registry repositories. It needs repository contents read/write for the release
and automation branch, pull-request write access in the registry, and access to
send/receive repository dispatch events. Store its client ID and private key as
`LAPIS_REGISTRY_APP_CLIENT_ID` and `LAPIS_REGISTRY_APP_PRIVATE_KEY` secrets.

## Refreshing and recovering registry PRs

The **Refresh registry pull requests** workflow updates open registry-bot PRs
after changes to `main` and after the release-sync workflow completes. Each PR
keeps its number and discussion. The worker replays its original verified request
on current `main` and writes only its small queue record. Legacy PRs containing
generated files are converted in place, preserving their numbers and discussions.
Once a PR contains only its queue file it stays current across unrelated merges;
catalog generation is owned by the shared publication PR. Ordinary PR checks
verify the queued request and continue checking the committed signed catalog.

Run it manually from GitHub Actions on `main`, or use:

```sh
gh workflow run refresh-registry-prs.yml --ref main
gh workflow run refresh-registry-prs.yml --ref main -f pr_number=40 -f dry_run=true
gh workflow run refresh-registry-prs.yml --ref main -f recover_missing_releases=true
```

Leave `pr_number` blank to select all eligible bot PRs. `dry_run` verifies and
reports candidates without changing GitHub branches or descriptions, and needs
no registry private key. `recover_missing_releases` additionally discovers the
newest stable published release of each active lapis-plugins package and creates
missing registry PRs. It cannot be combined with `pr_number`. Recovery verifies
the existing archive and checksum against the committed trust root and resolved
release tag; it does not republish artifacts or activate private packages.

Discovery paginates PRs and releases, reports blocked candidates, and runs at
most three independent workers per sweep. Automatic sweeps coalesce; manual
runs keep distinct identities so an automatic event cannot discard a targeted,
dry-run or recovery request. Branch writes use a captured-head lease and
retry moving references up to three times. Human commits, unexpected files, and
competing changes to the same plugin's curated entry require manual
reconciliation. Closed PRs are not reopened and already-indexed releases are
reported without another submission. Already-queued releases also prevent
duplicate recovery. Review and merging remain maintainer-owned.

Bot descriptions carry the replay request in a versioned hidden record. Legacy
descriptions are recovered and checked against branch and source coordinates.
Only the managed description block is replaced; maintainer notes are retained.
The banner appears inline and the overview/gallery appear under **Plugin
screenshots**. Preview images link to full-size images at immutable source-commit
URLs, so they work before registry deployment and after branch deletion.

## Publishing a queued batch

The publication workflow runs after changes to `main` and prepares a batch when
merged requests are queued. It also has a
manual control, including a read-only dry run:

```sh
gh workflow run publish-registry-updates.yml --ref main
gh workflow run publish-registry-updates.yml --ref main -f dry_run=true
```

An empty queue creates no PR. The workflow runs trusted code from `main`, updates
only its bot-owned publication branch with a captured-head lease, and retries
moving references at most three times. Notes outside its managed description
block are preserved. A publication PR closed without merging needs maintainer
reconciliation or reopening; automation does not reopen it. Merging a publication
PR consumes only the requests in its reviewed batch. Requests merged later remain
queued for the next publication. A queue-only merge does not trigger deployment.

`registry:submissions:validate` checks record schemas and path coordinates.
`registry:submissions:verify` additionally verifies published artifacts and pinned
source metadata, with at most three concurrent verifications and no private
signing key. Both release dispatch and publication use the same underlying
verifier. Published artifact replacement and latest-version downgrades fail
closed; an already-indexed identical artifact is consumed without replacement.

## Standalone source repositories

The queue contract is independent of the source repository. A standalone sender
uses its own `repository`, scoped `package_name`, runtime `plugin_id`, release tag,
archive name, version and signed source commit in the unchanged dispatch payload.
The receiver reads `package.json`, `manifest.json`, `registry.json`, media and
`CHANGELOG.md` at that commit from the repository root. It never executes source
code downloaded from a plugin repository.

Onboarding still requires an installable signed `.lapis-plugin` archive and its
checksum, a release key approved in the registry trust root, matching package and
runtime coordinates, and valid registry metadata. The queue does not publish npm
packages, create archives, activate private plugins or grant trust to a new key.
Maintainers can also open a one-file submission PR directly using the same
versioned request record; PR checks perform the same read-only verification.
Tasks currently needs installable release archives and registry metadata before
it can submit through this flow; see the dated audit for the other readiness gaps.

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
