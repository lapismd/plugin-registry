#!/usr/bin/env node
import {
  buildDownloadSummary,
  loadDailySnapshots,
} from "./lib/download-stats.mjs";
import {
  createAjv,
  formatAjvErrors,
  readJsonIfExists,
  stableStringify,
} from "./lib/registry.mjs";

const statsDirectory = new URL("../stats/", import.meta.url);
const snapshots = await loadDailySnapshots(statsDirectory);
const summary = await readJsonIfExists(new URL("summary.json", statsDirectory));

if (snapshots.length === 0 && !summary) {
  console.log("No download statistics have been published yet.");
  process.exit(0);
}
if (!summary)
  throw new Error("stats/summary.json is required when daily files exist");

const ajv = await createAjv();
const validateDaily = ajv.getSchema(
  "https://registry.lapis.md/schemas/download-stats-daily.schema.json",
);
const validateSummary = ajv.getSchema(
  "https://registry.lapis.md/schemas/download-stats-summary.schema.json",
);
for (const snapshot of snapshots) {
  if (!validateDaily(snapshot)) {
    throw new Error(
      `stats/daily/${snapshot.date}.json: ${formatAjvErrors(validateDaily)}`,
    );
  }
}
if (!validateSummary(summary)) {
  throw new Error(`stats/summary.json: ${formatAjvErrors(validateSummary)}`);
}

const rebuilt = buildDownloadSummary({
  snapshots,
  trackedSince: summary.trackedSince,
  generatedAt: summary.generatedAt,
});
if (stableStringify(rebuilt) !== stableStringify(summary)) {
  throw new Error(
    "stats/summary.json is not a complete rebuild of stats/daily",
  );
}

console.log(
  `Validated ${snapshots.length} immutable daily snapshot(s) through ${summary.through}.`,
);
