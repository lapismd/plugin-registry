import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stableStringify } from "./registry.mjs";

export const downloadStatsDataset = "lapis_plugin_downloads_v1";
export const downloadStatsMetric = "approximate_redirect_requests";
export const downloadStatsDelayDays = 2;

const actions = new Set(["install", "update", "download", "unknown"]);
const platforms = new Set(["web", "desktop", "unknown"]);
const operatingSystems = new Set([
  "macos",
  "windows",
  "linux",
  "ios",
  "android",
  "unknown",
]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dailyFilenamePattern = /^(\d{4}-\d{2}-\d{2})\.json$/;
const pluginIdPattern = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function formatUtcDate(value) {
  return value.toISOString().slice(0, 10);
}

export function parseUtcDate(value, label = "date") {
  if (!datePattern.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || formatUtcDate(parsed) !== value) {
    throw new Error(`${label} is not a valid UTC date`);
  }
  return parsed;
}

export function addUtcDays(value, amount) {
  const date = typeof value === "string" ? parseUtcDate(value) : value;
  return new Date(date.valueOf() + amount * 86_400_000);
}

export function eligibleDownloadDates({
  cutoverDate,
  today,
  existingDates = [],
  delayDays = downloadStatsDelayDays,
}) {
  const first = parseUtcDate(cutoverDate, "cutover date");
  const last = addUtcDays(parseUtcDate(today, "today"), -delayDays);
  const existing = new Set(existingDates);
  const dates = [];
  for (let cursor = first; cursor <= last; cursor = addUtcDays(cursor, 1)) {
    const date = formatUtcDate(cursor);
    if (!existing.has(date)) dates.push(date);
  }
  return dates;
}

export function createAnalyticsQuery(date) {
  const start = parseUtcDate(date, "snapshot date");
  const end = addUtcDays(start, 1);
  return `SELECT
  blob1 AS pluginId,
  blob2 AS version,
  blob3 AS action,
  blob4 AS platform,
  blob5 AS os,
  SUM(_sample_interval) AS count
FROM ${downloadStatsDataset}
WHERE timestamp >= '${formatUtcDate(start)} 00:00:00'
  AND timestamp < '${formatUtcDate(end)} 00:00:00'
GROUP BY blob1, blob2, blob3, blob4, blob5
ORDER BY pluginId, version, action, platform, os
FORMAT JSON`;
}

export function parseAnalyticsResponse(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray(value.data) ||
    !Number.isSafeInteger(value.rows) ||
    value.rows !== value.data.length
  ) {
    throw new Error("Analytics Engine returned a malformed JSON result");
  }
  return value.data;
}

export function buildDailySnapshot({ date, rows, generatedAt }) {
  parseUtcDate(date, "snapshot date");
  assertTimestamp(generatedAt, "generatedAt");
  if (!Array.isArray(rows)) {
    throw new Error("Daily download rows must be an array");
  }

  const totals = new Map();
  for (const row of rows) {
    const normalized = normalizeRow(row);
    const key = rowKey(normalized);
    const previous = totals.get(key);
    totals.set(key, {
      ...normalized,
      count: (previous?.count ?? 0) + normalized.count,
    });
  }

  return {
    schemaVersion: 1,
    date,
    generatedAt,
    dataset: downloadStatsDataset,
    metric: downloadStatsMetric,
    rows: [...totals.values()].sort(compareRows),
  };
}

export function assertDailySnapshot(value, expectedDate) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    value.dataset !== downloadStatsDataset ||
    value.metric !== downloadStatsMetric ||
    !Array.isArray(value.rows)
  ) {
    throw new Error("Invalid daily download snapshot metadata");
  }
  parseUtcDate(value.date, "snapshot date");
  if (expectedDate && value.date !== expectedDate) {
    throw new Error(
      `Daily snapshot date ${value.date} does not match ${expectedDate}`,
    );
  }
  assertTimestamp(value.generatedAt, "generatedAt");
  const normalized = value.rows.map(normalizeRow).sort(compareRows);
  if (stableStringify(value.rows) !== stableStringify(normalized)) {
    throw new Error(`Daily snapshot ${value.date} rows are not sorted`);
  }
  const keys = normalized.map(rowKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Daily snapshot ${value.date} contains duplicate rows`);
  }
  return value;
}

export function buildDownloadSummary({ snapshots, trackedSince, generatedAt }) {
  parseUtcDate(trackedSince, "tracked since");
  assertTimestamp(generatedAt, "generatedAt");
  const ordered = snapshots
    .map((snapshot) => assertDailySnapshot(snapshot))
    .sort((a, b) => compareText(a.date, b.date));
  const dates = ordered.map((snapshot) => snapshot.date);
  if (new Set(dates).size !== dates.length) {
    throw new Error("Daily snapshots contain duplicate dates");
  }
  if (dates.some((date) => date < trackedSince)) {
    throw new Error("Daily snapshots cannot predate the tracking cutover");
  }

  const through = dates.at(-1) ?? null;
  const periods = {};
  for (const [name, days] of [
    ["lifetime", null],
    ["7d", 7],
    ["30d", 30],
  ]) {
    const from = through
      ? days === null
        ? trackedSince
        : maxDate(trackedSince, formatUtcDate(addUtcDays(through, 1 - days)))
      : null;
    periods[name] = summarizeRows(
      ordered
        .filter((snapshot) => from === null || snapshot.date >= from)
        .flatMap((snapshot) => snapshot.rows),
      from,
      through,
    );
  }

  return {
    schemaVersion: 1,
    generatedAt,
    dataset: downloadStatsDataset,
    metric: downloadStatsMetric,
    trackedSince,
    through,
    periods,
  };
}

export async function loadDailySnapshots(statsDirectory) {
  const dailyDirectory = path.join(toPath(statsDirectory), "daily");
  let entries;
  try {
    entries = await fs.readdir(dailyDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const snapshots = [];
  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    if (!entry.isFile()) continue;
    const match = dailyFilenamePattern.exec(entry.name);
    if (!match) {
      throw new Error(`Unexpected file in stats/daily: ${entry.name}`);
    }
    const value = JSON.parse(
      await fs.readFile(path.join(dailyDirectory, entry.name), "utf8"),
    );
    snapshots.push(assertDailySnapshot(value, match[1]));
  }
  return snapshots;
}

export async function queryDownloadDay({
  date,
  accountId,
  apiToken,
  fetchImpl = fetch,
}) {
  if (!accountId || !apiToken) {
    throw new Error(
      "Cloudflare account ID and Analytics read token are required",
    );
  }
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "text/plain; charset=utf-8",
      },
      body: createAnalyticsQuery(date),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Analytics Engine query for ${date} failed with HTTP ${response.status}`,
    );
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(`Analytics Engine query for ${date} returned invalid JSON`);
  }
  return parseAnalyticsResponse(value);
}

export async function aggregateDownloadStats({
  rootDirectory,
  cutoverDate,
  today,
  generatedAt,
  accountId,
  apiToken,
  fetchImpl = fetch,
  beforePublish,
}) {
  const root = toPath(rootDirectory);
  const statsDirectory = path.join(root, "stats");
  const existing = await loadDailySnapshots(statsDirectory);
  const missingDates = eligibleDownloadDates({
    cutoverDate,
    today,
    existingDates: existing.map((snapshot) => snapshot.date),
  });
  if (missingDates.length === 0) {
    const existingSummary = await readJsonIfExists(
      path.join(statsDirectory, "summary.json"),
    );
    if (existingSummary) {
      try {
        const rebuilt = buildDownloadSummary({
          snapshots: existing,
          trackedSince: cutoverDate,
          generatedAt: existingSummary.generatedAt,
        });
        if (stableStringify(rebuilt) === stableStringify(existingSummary)) {
          return { missingDates, summary: existingSummary };
        }
      } catch {
        // Replace malformed or stale derived state from the immutable daily files.
      }
    }
  }
  const stagedDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "lapis-download-stats-"),
  );

  try {
    const additions = [];
    for (const date of missingDates) {
      const rows = await queryDownloadDay({
        date,
        accountId,
        apiToken,
        fetchImpl,
      });
      const snapshot = buildDailySnapshot({ date, rows, generatedAt });
      additions.push(snapshot);
      await writeJson(
        path.join(stagedDirectory, "daily", `${date}.json`),
        snapshot,
      );
    }

    const summary = buildDownloadSummary({
      snapshots: [...existing, ...additions],
      trackedSince: cutoverDate,
      generatedAt,
    });
    const stagedSummary = path.join(stagedDirectory, "summary.json");
    await writeJson(stagedSummary, summary);

    await beforePublish?.({ missingDates, summary });
    const dailyDirectory = path.join(statsDirectory, "daily");
    await fs.mkdir(dailyDirectory, { recursive: true });
    for (const date of missingDates) {
      const target = path.join(dailyDirectory, `${date}.json`);
      await fs.copyFile(
        path.join(stagedDirectory, "daily", `${date}.json`),
        target,
        fsConstants.COPYFILE_EXCL,
      );
    }
    await replaceFile(stagedSummary, path.join(statsDirectory, "summary.json"));
    return { missingDates, summary };
  } finally {
    await fs.rm(stagedDirectory, { recursive: true, force: true });
  }
}

export async function rebuildDownloadSummary({
  rootDirectory,
  trackedSince,
  generatedAt,
}) {
  const statsDirectory = path.join(toPath(rootDirectory), "stats");
  const snapshots = await loadDailySnapshots(statsDirectory);
  const summary = buildDownloadSummary({
    snapshots,
    trackedSince,
    generatedAt,
  });
  await writeJson(path.join(statsDirectory, "summary.json"), summary);
  return summary;
}

export async function publishDownloadStats({
  sourceDirectory,
  targetDirectory,
}) {
  const source = toPath(sourceDirectory);
  const target = toPath(targetDirectory);
  await fs.rm(target, { recursive: true, force: true });
  if (!(await pathExists(source))) return false;
  await fs.cp(source, target, { recursive: true });
  return true;
}

function normalizeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Download count row must be an object");
  }
  const pluginId = requiredString(row.pluginId, "pluginId");
  if (!pluginIdPattern.test(pluginId)) {
    throw new Error(`Unexpected download pluginId: ${pluginId}`);
  }
  const version = requiredString(row.version, "version");
  const action = allowedDimension(row.action, actions, "action");
  const platform = allowedDimension(row.platform, platforms, "platform");
  const os = allowedDimension(row.os, operatingSystems, "os");
  const count = Number(row.count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Download count must be a non-negative safe integer");
  }
  return { pluginId, version, action, platform, os, count };
}

function summarizeRows(rows, from, through) {
  let total = 0;
  const plugins = new Map();
  const versions = new Map();
  const actionTotals = new Map();
  const platformTotals = new Map();
  const osTotals = new Map();

  for (const row of rows) {
    total += row.count;
    addToMap(versions, `${row.pluginId}@${row.version}`, row.count);
    addToMap(actionTotals, row.action, row.count);
    addToMap(platformTotals, row.platform, row.count);
    addToMap(osTotals, row.os, row.count);
    const plugin = plugins.get(row.pluginId) ?? {
      total: 0,
      versions: new Map(),
    };
    plugin.total += row.count;
    addToMap(plugin.versions, row.version, row.count);
    plugins.set(row.pluginId, plugin);
  }

  return {
    from,
    through,
    total,
    plugins: Object.fromEntries(
      [...plugins.entries()]
        .sort(([a], [b]) => compareText(a, b))
        .map(([pluginId, plugin]) => [
          pluginId,
          {
            total: plugin.total,
            versions: sortedMapObject(plugin.versions),
          },
        ]),
    ),
    versions: sortedMapObject(versions),
    actions: sortedMapObject(actionTotals),
    platforms: sortedMapObject(platformTotals),
    os: sortedMapObject(osTotals),
  };
}

function sortedMapObject(map) {
  return Object.fromEntries(
    [...map.entries()].sort(([a], [b]) => compareText(a, b)),
  );
}

function addToMap(map, key, amount) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function rowKey(row) {
  return [row.pluginId, row.version, row.action, row.platform, row.os].join(
    "\0",
  );
}

function compareRows(a, b) {
  return compareText(rowKey(a), rowKey(b));
}

function compareText(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function allowedDimension(value, allowed, label) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`Unexpected download ${label}: ${String(value)}`);
  }
  return value;
}

function assertTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    !value.endsWith("Z")
  ) {
    throw new Error(`${label} must be a UTC ISO timestamp`);
  }
}

function maxDate(a, b) {
  return a > b ? a : b;
}

function toPath(value) {
  if (value instanceof URL) return fileURLToPath(value);
  return path.resolve(value);
}

async function writeJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, `${stableStringify(value, 2)}\n`);
}

async function replaceFile(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporaryTarget = `${target}.${process.pid}.tmp`;
  await fs.copyFile(source, temporaryTarget);
  await fs.rename(temporaryTarget, target);
}

async function readJsonIfExists(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function pathExists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
