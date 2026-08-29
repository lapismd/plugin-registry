# Anonymous plugin download analytics

The registry counts requests that pass through its optional download redirect.
Plugin bundles remain immutable assets owned by their release repository. The
signed `bundle.url` is the verified artifact origin and direct fallback;
`bundle.downloadUrl` is an additive V1 reference to the registry redirect.

This design leaves the registry portable. A mirror can publish all signed V1
metadata, pages, documentation, and `stats/` as ordinary static files. It can
omit the redirect Function entirely, in which case clients continue to use the
signed origin URL.

## Metric and privacy

`stats/` reports **approximate redirect requests**, not unique people, devices,
or confirmed installations. Counts can include retries, automation, and direct
website downloads. Older clients and downloads made directly from the artifact
origin are not counted.

One Analytics Engine point is written before each eligible `GET` redirect. It
uses `pluginId@version` as the index and exactly five normalized blobs:

1. Plugin ID
2. Version
3. Action: `install`, `update`, `download`, or `unknown`
4. Platform: `web`, `desktop`, `electron`, or `unknown`
5. OS: `macos`, `windows`, `linux`, `ios`, `android`, or `unknown`

The endpoint does not record an IP address, raw user agent, referrer, user ID,
machine ID, installation ID, or vault ID. Analytics is best-effort: a missing
binding or failed write cannot block the redirect. `HEAD` and `OPTIONS` do not
write events.

The website wording is deliberately explicit: `Tracked downloads since
<cutover date>. Approximate redirect requests.` The count is hidden when the
summary is missing, malformed, more than five UTC days behind, or unavailable.

## Static records

`stats/daily/YYYY-MM-DD.json` is the durable event aggregate. Each file contains
metadata and sorted rows shaped as:

```json
{
  "pluginId": "lapis-docs",
  "version": "2026.6.6",
  "action": "install",
  "platform": "desktop",
  "os": "macos",
  "count": 12
}
```

The query uses `SUM(_sample_interval)` so counts remain sampling-aware. Empty
days are written as valid snapshots with no rows. A daily file is never
overwritten. `stats/summary.json` is derived exclusively from all daily files
and contains lifetime, trailing 7-day, and trailing 30-day totals plus plugin,
version, action, platform, and OS breakdowns.

No historic origin downloads are backfilled. The first eligible day is the
configured production cutover date. A day becomes eligible two complete UTC
days later, allowing late Analytics Engine points to settle.

## Required Cloudflare and GitHub configuration

The committed Pages configuration binds `PLUGIN_DOWNLOADS` to
`lapis_plugin_downloads_v1`. `_routes.json` sends only `/download/*` through the
Function. `_headers` supplies static CORS for `/v1/*` and `/stats/*`; all other
registry traffic remains ordinary Pages static traffic.

The scheduled workflow requires:

- Secret `CLOUDFLARE_ANALYTICS_API_TOKEN`, scoped only to Account Analytics
  Read, for Analytics Engine SQL queries.
- Existing secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the
  separate Pages deployment lookup and deployment.
- Existing GitHub App secrets `LAPIS_REGISTRY_APP_CLIENT_ID` and
  `LAPIS_REGISTRY_APP_PRIVATE_KEY`, with contents write access limited to this
  repository.
- Repository variable `DOWNLOAD_STATS_CUTOVER_DATE` in `YYYY-MM-DD` form.
- Repository variable `DOWNLOAD_STATS_AUTOMATION_APPROVED=true` only after the
  production smoke test and cutover approval.

The `Publish download statistics` workflow runs at 04:17 UTC and supports
manual dispatch. The GitHub App may receive protected-branch bypass only for
this workflow's direct `stats/**` commit path. It must not receive a general
branch-protection bypass.

The Pages project must continue using the repository's explicit Wrangler
deployments rather than an independent Git-integration deploy-on-push. Otherwise
a statistics commit could bypass the path guard before the workflow evaluates
the production diff.

Before querying, the workflow records the commit currently deployed to the
production Pages project. After a successful aggregate is committed, the
workflow compares that commit with `HEAD`. It deploys automatically only when
every intervening path is under `stats/`. Any pending registry metadata, code,
workflow, or site change causes a safe deployment skip; the snapshots remain
committed for the next approved deployment.

## Recovery and audit

The workflow stages every missing response before it changes `stats/`. A query,
parse, validation, or aggregation failure occurs before the Git commit, so the
run commits nothing. The next successful run retries all missing days.

Analytics Engine currently provides the short-term recovery window configured
for the account; operations should treat three months as the maximum backfill
window and investigate a missing day well before then. The immutable files are
the long-term record and can be audited or used to reproduce the summary:

```sh
DOWNLOAD_STATS_CUTOVER_DATE=YYYY-MM-DD pnpm stats:validate
DOWNLOAD_STATS_CUTOVER_DATE=YYYY-MM-DD pnpm stats:summary
```

If a published daily file is wrong, do not overwrite or delete it as routine
recovery. Pause automation, preserve the file and source query evidence, and
agree an explicit correction format before resuming. If only the summary is
wrong, regenerate it from the daily files.

## Rollout gate

Keep `DOWNLOAD_STATS_AUTOMATION_APPROVED` unset while deploying the redirect
endpoint for the first time. Run the protected `Sign registry metadata`
workflow with `REGISTRY_SIGN_APPROVED`, review and merge its generated-only pull
request, and confirm each release contains both the origin and tracking
reference. The manual production workflow refuses uncommitted generated changes
and deploys the reviewed signatures without handling the private signing key.
After verifying
exact redirects, web and desktop fallback, static routing, and an anonymous
Analytics Engine point, record the UTC cutover date and enable the scheduled
workflow. The first immutable daily file should appear only after the two-day
delay.
