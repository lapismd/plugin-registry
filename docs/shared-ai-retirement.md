# Shared AI distribution retirement

The external `@lapis-notes/ai` package from `lapismd/lapis-plugins` is retired.
Its mutable catalog source is disabled. Release/metadata dispatch validation,
direct sync and queued replay reject its provenance before network or writes;
entry validation rejects reactivation. The matching rule is scoped to the source
repository and shared package coordinates, not a global ban on plugin ID `ai`.
Tauri-owned AI and App Profile native chat remain owned by their current hosts.

Historical versions, bundle URLs, checksums, signatures, assets and generated
catalogs are retained. Do not edit signed generated files by hand. The normal
reviewed publication workflow must regenerate and sign new mutable metadata
before the source disablement becomes effective on the hosted registry. Existing
signed metadata remains the published truth until then. Deployment, UI/direct
API/stale-cache acceptance and npm deprecation remain separate pending gates.
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

## Next boundary

Sign and publish the disabled mutable metadata through the ordinary reviewed
workflow, then prove deployed registry, direct Notes API and stale-cache behavior.
The published signed catalog still represents its previous state. Retire the
shared implementation and consuming catalogs/probes separately, preserve native
AI/data, and leave npm deprecation behind its explicit release gate.
