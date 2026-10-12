# API-owned registry schema migration

The site, V2 generator, and source metadata reader use
`@lapis-notes/api/registry/schema` with dependency range `^0.1.1`. Community is
absent from the active manifest and installed local graph. The API 0.1.1 tarball
is checksum-pinned for temporary development acceptance; its npm publication
must precede the portable lock refresh and production frozen-install gate.

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
