# Disabled download responses

Disabled indexed releases return HTTP 410 Gone from the registry download
endpoint, with the existing CORS and no-store headers. GET and HEAD refuse before
origin fetch or download analytics. The response body for GET is `Plugin release
disabled`; HEAD has no body. Unknown and pending releases remain 404, revoked
releases retain their existing 410 response, and active releases still stream
their pinned archive.

The user explicitly approved this public HTTP response change on 2026-11-17.
It closes the stale-client path found after the approved shared-AI retirement
deployment at `42903595b7ea78194d47635319dfa0f5046ab5bb`.

## Consumer reason

Notes' `VerifiedPluginInstaller.install()` tries a signed registry download URL
before its preserved signed artifact origin. Transient endpoint failures may
fall back to that origin. Cancellation and HTTP 410 already prevent fallback.
The earlier registry response was 404 for disabled releases, so an old active
index/detail could still reach the historical artifact through that fallback.
The manager's fresh disabled-index check alone does not cover that old state.

Using the existing authoritative 410 response closes that path without a new
consumer package release or a global ban on plugin ID `ai`. It does not revoke
or delete historical artifacts, uninstall packages, rewrite installed records,
or remove settings, conversations or memory. The signed disabled metadata and
its signatures do not change in this follow-up.

## Regression evidence

The original exact target, `node --test
scripts/__tests__/retired-ai.test.mjs
scripts/__tests__/download-function.test.mjs`, passed 15 cases. Requiring 410
for the retired indexed versions reproduced 1 failure and 14 passes. After the
handler change the same target passes, with a new generic disabled-release case:
16 passed, 0 failed. Every retired version is checked for both GET and HEAD;
the generic case also asserts no origin request, analytics write or redirect,
correct CORS and an empty HEAD body.

Full `pnpm check` now passes: 19 source entries, 21 metadata signatures,
Astro checks/static build, 147 unit tests, 26 cold browser cases and formatting.
The first browser run had 25 passes and one footer timestamp failure because
this non-colocated JJ workspace did not supply the documented source timestamp.
With `LAPIS_REGISTRY_UPDATED_AT` set to the exact JJ source timestamp, the exact
footer target passes 1/1 and the complete owner check passes. No assertion or
production timestamp logic changed.

Notes' unchanged installer target was executed in its registry-only Docker lane:
`test -- --filter=@lapis-notes/api --task-args
src/lib/__tests__/plugin-installer.test.ts -t 'does not fall back after the signed
download endpoint reports revocation'`. The exact target passes 1 case; the other
27 are excluded by that selection. The complete installer file then passes all
28 cases, including ordinary origin fallback and refusal after HTTP 410 with an
active catalog fixture. Both targets record no origin fetch for the 410 case.
[Exact consumer invocation receipts](disabled-download-response-consumer.json)
retain source, image, command and outcome for each run.

The endpoint's complete response helper remains no-store and CORS-readable.
The current Cloudflare Workers best-practices reference and published
`@cloudflare/workers-types@5.20261117.1` were reviewed for this handler change;
no platform configuration, dependency or binding changes are needed. The
production change adds only the disabled-status early return.

PR [#183](https://github.com/lapismd/plugin-registry/pull/183) merged exact
reviewed head `ca8421f515e54aa0da32ea65018ca662039829fb` as
`e99f5fd40c92a779b26fcab4a5efa84372d6f4a3`. Hosted Checks
[44166043673](https://github.com/lapismd/plugin-registry/actions/runs/44166043673)
and production publication
[44166153748](https://github.com/lapismd/plugin-registry/actions/runs/44166153748)
passed. Live GET and HEAD requests for every indexed retired AI version return 410. The earlier 404 behavior remains historical evidence of the gap rather than
current stale-client behavior.
