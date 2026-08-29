#!/usr/bin/env node
import {
  aggregateDownloadStats,
  formatUtcDate,
} from "./lib/download-stats.mjs";

const options = parseOptions(process.argv.slice(2));
const cutoverDate = options.cutover ?? process.env.DOWNLOAD_STATS_CUTOVER_DATE;
if (!cutoverDate) {
  throw new Error(
    "Set DOWNLOAD_STATS_CUTOVER_DATE or pass --cutover YYYY-MM-DD",
  );
}

const now = options.now ? new Date(options.now) : new Date();
if (Number.isNaN(now.valueOf()))
  throw new Error("--now must be an ISO timestamp");
const result = await aggregateDownloadStats({
  rootDirectory: new URL("../", import.meta.url),
  cutoverDate,
  today: options.today ?? formatUtcDate(now),
  generatedAt: options.generatedAt ?? now.toISOString(),
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  apiToken: process.env.CLOUDFLARE_ANALYTICS_API_TOKEN,
});

console.log(
  result.missingDates.length === 0
    ? `No missing eligible UTC days; rebuilt summary through ${result.summary.through ?? "no snapshots"}.`
    : `Published ${result.missingDates.length} immutable daily snapshot(s) through ${result.summary.through}.`,
);

function parseOptions(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!["--cutover", "--today", "--now", "--generated-at"].includes(name)) {
      throw new Error(`Unknown argument: ${name}`);
    }
    const value = args[index + 1];
    if (!value) throw new Error(`${name} requires a value`);
    values[
      {
        "--cutover": "cutover",
        "--today": "today",
        "--now": "now",
        "--generated-at": "generatedAt",
      }[name]
    ] = value;
    index += 1;
  }
  return values;
}
