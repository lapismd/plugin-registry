#!/usr/bin/env node
import { rebuildDownloadSummary } from "./lib/download-stats.mjs";

const trackedSince =
  valueAfter("--tracked-since") ?? process.env.DOWNLOAD_STATS_CUTOVER_DATE;
if (!trackedSince) {
  throw new Error(
    "Set DOWNLOAD_STATS_CUTOVER_DATE or pass --tracked-since YYYY-MM-DD",
  );
}
const generatedAt = valueAfter("--generated-at") ?? new Date().toISOString();
const summary = await rebuildDownloadSummary({
  rootDirectory: new URL("../", import.meta.url),
  trackedSince,
  generatedAt,
});
console.log(
  `Rebuilt stats/summary.json through ${summary.through ?? "no snapshots"}.`,
);

function valueAfter(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
