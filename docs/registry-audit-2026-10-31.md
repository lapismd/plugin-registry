# Registry listing audit: 2026-10-31

The published V2 index and registry `main` at `d9a1541a` contain 13 plugins.
The active lapis-plugins inventory at `be302f37` contains 17; Community and Sync
are private and intentionally excluded.

| Finding                                                   | Plugins                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Missing entirely; published 0.2.0 archives exist          | Canvas, CSV, DOCX, PDF                                                                |
| Older version indexed; newest published release has no PR | AI, Bookmarks, Graph, Markdown, Markdown Lint, Search                                 |
| Newest release has an open PR                             | Bases #39, History #40, Slides #36, Source Editor #34, Spellcheck #37, Word Count #38 |
| Newest published release indexed                          | Transcripts                                                                           |

The ten missing/stale submissions failed source-coordinate verification. The
archives for nine bind source `2e3887a6cb039198c2ab627d3ce1e17f9070e49c`;
AI 0.1.6 binds `24fd4dc8be467a3c08a8780086a7f07c5afd1ab5`.
All ten passed the existing receiver's checksum, signature, signed-file,
runtime, source ownership and metadata verification in isolated dry runs using
those coordinates. These are immutable release-recovery candidates, not new
publications. Fresh discovery must recheck this snapshot before recovery.

Standalone readiness is separate. Docs has no GitHub releases. Tasks and
Notebook releases expose npm artifacts without `.lapis-plugin` archives.
CV Roles, Terminal and Nostr Sync release availability could not be confirmed
through the connected GitHub app or local GitHub credentials. Their absence
must not be treated as approval to publish or enable them. Local source checks
also found no registry metadata for Roles, Docs, Tasks, Terminal or Notebook;
Nostr Sync has older metadata requiring its own compatibility qualification.

Sources: [registry index](https://registry.lapis.md/v2/index.json),
[plugin releases](https://github.com/lapismd/lapis-plugins/releases), and
[registry sync runs](https://github.com/lapismd/plugin-registry/actions/workflows/sync-plugin-release.yml).

## Refresh implementation qualification

- The implemented discovery and worker verified all 16 recovery/refresh
  candidates in a read-only live dry run. The sender separately verified all
  17 current published plugin archives and resolved their original source tags.
- `pnpm check` passed with 104 unit tests, 25 cold browser tests, Astro checks,
  site build, registry signatures and formatting. `registry:validate:remote`
  separately passed for every currently indexed bundle. In the isolated JJ
  workspace, the browser run supplied the documented
  `LAPIS_REGISTRY_UPDATED_AT=2026-10-31T19:12:34Z` input because Git metadata is
  absent; the footer target first failed without it and passed with it.
- A temporary catalog containing all 16 candidate updates (17 total plugins)
  passed strict remote validation and the complete check lane with ephemeral
  test signing keys. This exposed the latest-URL changelog fixture: Source
  Editor 0.1.3 correctly has four bullets, while the existing regression expects
  0.1.2's one bullet. The exact narrow browser target failed once, then passed
  after pinning its URL to 0.1.2; every content, count and layout assertion is
  retained. Pending version placeholders also have an explicit recovery
  regression and are not treated as indexed installable archives.
- Both installed and latest actionlint reject `client-id` using stale bundled
  action metadata. The live `actions/create-github-app-token@v3/action.yml`
  defines that input and deprecates `app-id`; existing successful sync runs use
  the same input. No diagnostic suppression or workflow allowlist was added.
- The optional dependency audit reports 79 existing advisories (10 low,
  31 moderate, 37 high, one critical). The manifest and lockfile remain identical
  to the baseline. Dependency remediation is separate from listing recovery.

## Queued publication qualification: 2026-11-01

The recovery run [41254526145](https://github.com/lapismd/plugin-registry/actions/runs/41254526145)
created the ten missing submissions as PRs #42–#51. Source Editor #34 merged
during qualification. Its main-branch change exercised automatic refresh: the
rebuilt CSV candidate retained both CSV 0.2.0 and Source Editor 0.1.3.

The revised flow keeps each submission to one small versioned request under
`submissions/<plugin-id>/<version>.jsonc`. Merging submissions queues them. One
reviewable publication PR replays the approved requests, updates the curated
entries, mirrors media, regenerates and signs the catalog, and consumes the
queue records. A queue-only merge does not deploy. Existing deployment approval
and environment gates remain in place. Standalone requests use the same contract;
the packaging and onboarding gaps above still apply.

- The separation regression first failed once against the old signing worker,
  then passed after signing moved to publication. All 35 focused cases passed.
- All 15 remaining open requests passed the new read-only verifier using their
  real published archives and original source coordinates. Replaying them through
  the queue consumer produced 17 plugins, retained prior versions and consumed
  every request. This local candidate used an ephemeral test signing key.
- The combined candidate passed strict remote validation and `pnpm check`: 117
  unit tests, 25 cold browser tests, types, build, signatures and formatting. The
  isolated workspace supplied `LAPIS_REGISTRY_UPDATED_AT=2026-10-31T23:58:41Z`.
  Temporary entries, mirrored assets, signatures and trust-root changes were
  restored after qualification; no release assets or screenshots were authored.
- Metadata tests cover older content, divergent history, source ownership and
  a new dispatch after the preceding metadata PR merged. Publication tests cover
  independent submissions, version ordering, immutable indexed artifacts,
  dry runs, concurrent main/head updates, bot-owned orphan recovery, human edits,
  closed PRs, unexpected files and preservation of maintainer notes.
- One earlier Word Count refresh worker failed in `pnpm test` without retaining
  the child output. Its exact current-main-plus-entry reproduction passed all
  104 then-existing tests, and the unchanged targeted retry
  [41255597354](https://github.com/lapismd/plugin-registry/actions/runs/41255597354)
  passed. The original cause remains unconfirmed. Workers now retain failed
  command stdout/stderr and refresh summaries link to the affected PR.
- The dependency audit still reports the same 79 pre-existing advisories; no
  dependency ranges, lockfiles or ignores changed. Actionlint reports only the
  previously documented stale `create-github-app-token@v3` input metadata, with
  no suppressions added.

## Hosted build-fixture portability

All 15 open plugin PRs converted to single request files. During their CI,
[DOCX #46](https://github.com/lapismd/plugin-registry/actions/runs/41257682009/job/124704230407)
passed archive and queue verification but failed one of 117 unit cases:
`site build emits signed V2 pages and retains the V1 archive` in
`scripts/__tests__/site-output.test.mjs`. Astro's asset rename from the checkout's
`.astro/.prerender` cache into the system `/tmp` fixture failed with `EXDEV` on a
runner where those paths use different filesystems.

The fixture now uses the checkout's ignored `tmp/site-output-*` directory, keeping
cache and output on one filesystem. Every existing assertion is retained. The
exact target (`node --test scripts/__tests__/site-output.test.mjs`) passed after
the change, and the full `pnpm check` lane passed all 117 unit and 25 cold browser
cases, signatures, type/build and formatting checks. The local macOS target also
passed before the change because its system temporary directory shares the
checkout filesystem; the hosted log supplies the failing environment evidence.

## Independent merges and maintainer curation

At the maintainer's request, required status checks now use `strict: false`,
removing the up-to-date branch restriction. The `checks` context remains required.
The complete protection response was compared before and after the update;
every other setting was unchanged. The proposed ancestry-refresh change in
PR #54 was closed without merging. Verified one-file submission PRs can therefore
remain current across unrelated main-branch changes.

Publication updates also compare each already-pending plugin's curated entry on
current `main` with the publication PR's merge base. A competing semantic entry
change requires manual reconciliation before the bot can rebuild or publish the
batch. Unrelated plugin edits and formatting-only differences do not trigger it.
The exact publication-discovery regression failed once before this guard and
passed after it. Full `pnpm check` passed all 117 unit and 25 cold browser cases,
signatures, types, build and formatting using the documented timestamp input.
