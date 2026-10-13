# API-owned registry schema migration

The site, V2 generator, and source metadata reader use
`@lapis-notes/api/registry/schema` with dependency range `^0.1.2`. Community is
absent from the active manifest and installed local graph. API 0.1.2 is published on npm under `next` and exposes the required registry
subpaths. The committed portable lock now resolves it from npm; a clean frozen
install with pnpm hooks disabled passes.

Focused catalog/source tests pass 8/8. The full aggregate check passes against
13 metadata files signed with an isolated ephemeral test key: signature
verification, 77/77 script tests, 17/17 browser tests, Astro check/build, statistics
validation, and formatting. The initial browser launch found no executable for
an unlocked newer Playwright; restoring the existing locked development
versions repairs all 17 cases without changing assertions or production locks.

The default production check still requires the unsigned V2 cutover to be signed
with the approved production registry key. Its missing `generated/v2/index.sig`
is release work, not a schema-test failure. No production key or trust root is
used for fixture qualification. The current source preview remains at
http://127.0.0.1:4323/ and excludes private/parked Community.

## Resumed GitHub qualification

On 2026-10-13, the published dependency passes 8 focused schema/source tests,
77 script tests and all 17 browser scenarios. Astro check, formatting and strict
remote verification of the 11 existing published entries pass. Production V2
signature verification and site packaging still fail on the absent `index.sig`;
no test key replaces the approved production trust root.

The protected signing workflow now accepts an existing source branch and opens
its generated-only PR against that same branch. This permits reviewing the V2
source candidate before signing it, then including the approved signatures in
the final main PR. Dispatch still requires `REGISTRY_SIGN_APPROVED` and the
`registry-production` environment; deployment remains independently gated.
