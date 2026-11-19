# Shared AI distribution retirement

The external `@lapis-notes/ai` package from `lapismd/lapis-plugins` is retired.
Its mutable catalog source is disabled. Release/metadata dispatch validation,
direct sync and queued replay reject its provenance before network or writes;
entry validation rejects reactivation. The matching rule is scoped to the source
repository and shared package coordinates, not a global ban on plugin ID `ai`.
Tauri-owned AI and App Profile native chat remain owned by their current hosts.

Historical versions, bundle URLs, checksums, artifact signatures, assets and
archived catalogs are retained. Do not edit signed generated files by hand.
The user-approved protected workflow regenerated and signed mutable metadata as
recorded below. The disabled metadata and HTTP 410 download policy are deployed,
UI/direct API/stale-cache acceptance passes, and all eleven published npm
versions are deprecated without unpublishing. Historical artifacts and installed
data remain preserved.
This source safeguard does not uninstall plugins or alter user data.

Notes owns the cross-repository plan and resume checklist:
`docs/plans/legacy-runtime-retirement.md` and
`docs/plans/legacy-runtime-retirement-progress.md` in `lapis-notes`.

## Source qualification, 2026-11-17

Base: `0503bac93a3a3b6c1c64f5ec0d49cecf55ba5d6e`. JJ change: `qvlolmsk`.
The mutable source changes only AI's status; historical version records are
unchanged. No generated catalog, signature, download-target or asset diff is
included. A fixture generation/signing/build test uses an ephemeral test key.

| Command / boundary                                                  | Result                                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `node --test scripts/__tests__/github-sync.test.mjs` before changes | 11 passed                                                                                    |
| New retirement tests before guards                                  | 3 failures, 1 third-party-provenance control passed                                          |
| `node --test scripts/__tests__/retired-ai.test.mjs` after guards    | 5 passed, including every indexed version's GET/HEAD download rejection without origin fetch |
| Built disabled label regression                                     | 1 failure before fix, then passed                                                            |
| `pnpm test`                                                         | 146 passed, 0 failed; includes cold generated/signed fixture site build                      |
| `pnpm test:browser` with exact JJ source timestamp                  | 26 passed, 0 failed, fresh server                                                            |
| `pnpm registry:validate`                                            | 19 entries validated                                                                         |
| `pnpm registry:verify-signatures`                                   | 21 existing metadata signatures verified                                                     |
| `pnpm site:check`                                                   | 0 errors, 0 warnings, 4 hints                                                                |
| `pnpm site:build`                                                   | 162 pages built; retained signed V1 archive                                                  |
| `pnpm check:format`                                                 | Passed                                                                                       |

Initial browser run: 23 passed, 2 failed. One expectation still allowed an old
AI version; the generic pending-versus-published contract now uses a retained
Graph source fixture, with separate AI rejection coverage. The footer requires
`LAPIS_REGISTRY_UPDATED_AT` when a non-colocated JJ workspace has no Git HEAD;
the final run supplies the exact timestamp from `jj log -r @` through that
existing supported environment variable. A subsequent fixture expectation was
corrected to assert Graph's explicit preview version; no assertion was weakened.
The final full lane passes all 26 cases. Initial partial local install hit ENOSPC;
only this task's incomplete generated install/snapshot files were removed, then
the frozen install succeeded. Quarantined workspaces were not purged.

## Approved signed metadata

The user explicitly approved protected signing for source
`37ee50609d5fbb89ce4bc3bb81b1d3ec5d091df1`. Workflow
[44159554590](https://github.com/lapismd/plugin-registry/actions/runs/44159554590)
ran the existing main-owned `sign-registry-metadata.yml` with
`source_ref=retirement/shared-ai-distribution` and
`approval=REGISTRY_SIGN_APPROVED`. Artifact-origin validation, signing, all
verification checks and the generated-only guard passed.

Generated-only [PR #182](https://github.com/lapismd/plugin-registry/pull/182),
head `356412082836bb7629a3a6169412c5ab082e8eeb`, passed complete hosted Checks
[44159923356](https://github.com/lapismd/plugin-registry/actions/runs/44159923356)
and merged into the feature branch at
`812e4a44d3843e83cad15c1f34086843511703d3`. Its diff contains five files only:

- All nine indexed AI version download targets change from active to disabled.
- The mutable V2 index and AI document change only AI status and outer signatures.
- The corresponding index and AI detached signatures are refreshed.

Independent structural comparison confirms the remaining JSON content is exactly
unchanged, including every historical version, origin, hash and artifact record.
Local `pnpm registry:verify-signatures` verifies all 21 metadata signatures.
No signing material was printed, changed or read outside the protected workflow.
The complete parent PR subsequently passed final-head Checks `44160731689`.

## Production closure and retained boundary

The user separately approved merge and production deployment of source
[PR #181](https://github.com/lapismd/plugin-registry/pull/181) at
`36bd61e3488b4282d903a2004062ef36817f42c9`. Its main merge deploys through
`publish.yml` with the existing `STATIC_REGISTRY_V2_DEPLOY_APPROVED=true` gate.
No publication gate or repository variable was bypassed.

The approved source merged at
`42903595b7ea78194d47635319dfa0f5046ab5bb`; exact-main Checks and production
publication passed. Live index/detail signatures verify and the live
disabled-install browser case passes. Its initial 404 download response exposed
the stale signed-origin fallback recorded above; the user-approved
[HTTP 410 follow-up](disabled-download-response.md) merged as
`e99f5fd40c92a779b26fcab4a5efa84372d6f4a3`, passed Checks and production
publication, and now rejects every indexed retired version before origin fetch
or analytics writes.

Plugins PR
[#156](https://github.com/lapismd/lapis-plugins/pull/156) separately deprecated
all eleven published `@lapis-notes/ai` versions with bundled-Desktop replacement
guidance. No version was unpublished and all tarballs and integrity hashes remain
available as historical artifacts. Native/data acceptance remains owned by
Desktop and Notes. The safeguards do not uninstall plugins, delete
settings/conversations/memory or retire the standalone controller needed by the
excluded consumers.
