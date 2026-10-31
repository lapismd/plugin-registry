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
- `pnpm check` passed with 103 unit tests, 25 cold browser tests, Astro checks,
  site build, registry signatures and formatting. `registry:validate:remote`
  separately passed for every currently indexed bundle. In the isolated JJ
  workspace, the browser run supplied the documented
  `LAPIS_REGISTRY_UPDATED_AT=2026-10-31T19:12:34Z` input because Git metadata is
  absent; the footer target first failed without it and passed with it.
- Both installed and latest actionlint reject `client-id` using stale bundled
  action metadata. The live `actions/create-github-app-token@v3/action.yml`
  defines that input and deprecates `app-id`; existing successful sync runs use
  the same input. No diagnostic suppression or workflow allowlist was added.
- The optional dependency audit reports 79 existing advisories (10 low,
  31 moderate, 37 high, one critical). The manifest and lockfile remain identical
  to the baseline. Dependency remediation is separate from listing recovery.
