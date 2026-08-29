import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateDownloadStats,
  buildDailySnapshot,
  buildDownloadSummary,
  createAnalyticsQuery,
  eligibleDownloadDates,
  loadDailySnapshots,
  parseAnalyticsResponse,
  publishDownloadStats,
  rebuildDownloadSummary,
} from "../lib/download-stats.mjs";
import { createAjv, formatAjvErrors } from "../lib/registry.mjs";

const generatedAt = "2026-02-03T04:17:00.000Z";

test("Analytics query uses sampling-aware counts and a bounded UTC day", () => {
  const query = createAnalyticsQuery("2026-02-01");
  assert.match(query, /SUM\(_sample_interval\) AS count/);
  assert.match(query, /timestamp >= '2026-02-01 00:00:00'/);
  assert.match(query, /timestamp < '2026-02-02 00:00:00'/);
  assert.match(query, /FROM lapis_plugin_downloads_v1/);
  assert.match(query, /FORMAT JSON$/);
});

test("daily snapshots combine duplicate dimensions and sort rows", async () => {
  const snapshot = buildDailySnapshot({
    date: "2026-02-01",
    generatedAt,
    rows: [
      row({ pluginId: "lapis-tasks", count: "3" }),
      row({ pluginId: "lapis-docs", count: 2 }),
      row({ pluginId: "lapis-tasks", count: 4 }),
    ],
  });

  assert.deepEqual(snapshot.rows, [
    row({ pluginId: "lapis-docs", count: 2 }),
    row({ pluginId: "lapis-tasks", count: 7 }),
  ]);
  const ajv = await createAjv();
  const validate = ajv.getSchema(
    "https://registry.lapis.md/schemas/download-stats-daily.schema.json",
  );
  assert.equal(validate(snapshot), true, formatAjvErrors(validate));
});

test("empty UTC days are valid immutable snapshots", () => {
  const snapshot = buildDailySnapshot({
    date: "2026-02-01",
    generatedAt,
    rows: [],
  });
  assert.deepEqual(snapshot.rows, []);
});

test("eligible dates backfill every missing day through two days ago", () => {
  assert.deepEqual(
    eligibleDownloadDates({
      cutoverDate: "2026-02-01",
      today: "2026-02-06",
      existingDates: ["2026-02-02"],
    }),
    ["2026-02-01", "2026-02-03", "2026-02-04"],
  );
});

test("summary rebuilds lifetime, 7-day, 30-day, and breakdown totals", async () => {
  const summary = buildDownloadSummary({
    trackedSince: "2026-01-01",
    generatedAt,
    snapshots: [
      snapshot("2026-01-01", [row({ count: 2 })]),
      snapshot("2026-01-10", [
        row({ version: "2.0.0", action: "update", count: 3 }),
      ]),
      snapshot("2026-01-31", [
        row({ platform: "desktop", os: "linux", count: 5 }),
      ]),
    ],
  });

  assert.equal(summary.through, "2026-01-31");
  assert.equal(summary.periods.lifetime.total, 10);
  assert.equal(summary.periods["30d"].total, 8);
  assert.equal(summary.periods["7d"].total, 5);
  assert.equal(summary.periods.lifetime.plugins["lapis-docs"].total, 10);
  assert.deepEqual(summary.periods.lifetime.plugins["lapis-docs"].versions, {
    "1.0.0": 7,
    "2.0.0": 3,
  });
  assert.deepEqual(summary.periods.lifetime.actions, {
    install: 7,
    update: 3,
  });
  assert.deepEqual(summary.periods.lifetime.platforms, {
    desktop: 5,
    web: 5,
  });
  assert.deepEqual(summary.periods.lifetime.os, {
    linux: 5,
    macos: 5,
  });

  const ajv = await createAjv();
  const validate = ajv.getSchema(
    "https://registry.lapis.md/schemas/download-stats-summary.schema.json",
  );
  assert.equal(validate(summary), true, formatAjvErrors(validate));
});

test("aggregation stages all API responses before publishing and backfills gaps", async () => {
  await withTempRoot(async (root) => {
    await writeDaily(root, snapshot("2026-02-02", []));
    const queried = [];
    const result = await aggregateDownloadStats({
      rootDirectory: root,
      cutoverDate: "2026-02-01",
      today: "2026-02-05",
      generatedAt,
      accountId: "account-id",
      apiToken: "analytics-token",
      fetchImpl: async (_url, init) => {
        const date = /timestamp >= '(\d{4}-\d{2}-\d{2})/.exec(init.body)?.[1];
        queried.push(date);
        assert.equal(init.headers.authorization, "Bearer analytics-token");
        return Response.json({
          meta: [],
          data: date === "2026-02-01" ? [row({ count: "4" })] : [],
          rows: date === "2026-02-01" ? 1 : 0,
        });
      },
    });

    assert.deepEqual(queried, ["2026-02-01", "2026-02-03"]);
    assert.deepEqual(result.missingDates, ["2026-02-01", "2026-02-03"]);
    assert.equal(result.summary.periods.lifetime.total, 4);
    assert.deepEqual(
      (await loadDailySnapshots(path.join(root, "stats"))).map(
        (value) => value.date,
      ),
      ["2026-02-01", "2026-02-02", "2026-02-03"],
    );
  });
});

test("aggregation refuses to overwrite a daily file created during the run", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      aggregateDownloadStats({
        rootDirectory: root,
        cutoverDate: "2026-02-01",
        today: "2026-02-03",
        generatedAt,
        accountId: "account-id",
        apiToken: "analytics-token",
        fetchImpl: async () => Response.json({ meta: [], data: [], rows: 0 }),
        beforePublish: async () => {
          await writeDaily(root, snapshot("2026-02-01", []));
        },
      }),
      /EEXIST/,
    );
    await assert.rejects(fs.access(path.join(root, "stats", "summary.json")));
  });
});

test("malformed Analytics Engine responses fail the complete run", async () => {
  assert.throws(
    () => parseAnalyticsResponse({ data: [], rows: 1 }),
    /malformed JSON result/,
  );
  await withTempRoot(async (root) => {
    await assert.rejects(
      aggregateDownloadStats({
        rootDirectory: root,
        cutoverDate: "2026-02-01",
        today: "2026-02-03",
        generatedAt,
        accountId: "account-id",
        apiToken: "analytics-token",
        fetchImpl: async () => Response.json({ success: true, result: [] }),
      }),
      /malformed JSON result/,
    );
    await assert.rejects(fs.access(path.join(root, "stats", "daily")));
  });
});

test("summary regeneration reads immutable daily files only", async () => {
  await withTempRoot(async (root) => {
    await writeDaily(root, snapshot("2026-02-01", [row({ count: 9 })]));
    const summary = await rebuildDownloadSummary({
      rootDirectory: root,
      trackedSince: "2026-02-01",
      generatedAt,
    });
    const persisted = JSON.parse(
      await fs.readFile(path.join(root, "stats", "summary.json"), "utf8"),
    );
    assert.deepEqual(persisted, summary);
    assert.equal(persisted.periods.lifetime.total, 9);
  });
});

test("a no-op aggregation preserves the existing deterministic summary", async () => {
  await withTempRoot(async (root) => {
    await writeDaily(root, snapshot("2026-02-01", [row({ count: 3 })]));
    const first = await rebuildDownloadSummary({
      rootDirectory: root,
      trackedSince: "2026-02-01",
      generatedAt,
    });
    const result = await aggregateDownloadStats({
      rootDirectory: root,
      cutoverDate: "2026-02-01",
      today: "2026-02-03",
      generatedAt: "2026-02-04T04:17:00.000Z",
      accountId: "account-id",
      apiToken: "analytics-token",
      fetchImpl: async () => {
        throw new Error("no query expected");
      },
    });
    assert.deepEqual(result.missingDates, []);
    assert.deepEqual(result.summary, first);
  });
});

test("site publication copies statistics when present and tolerates absence", async () => {
  await withTempRoot(async (root) => {
    const source = path.join(root, "stats");
    const target = path.join(root, "dist", "stats");
    assert.equal(
      await publishDownloadStats({
        sourceDirectory: source,
        targetDirectory: target,
      }),
      false,
    );
    await writeDaily(root, snapshot("2026-02-01", []));
    await rebuildDownloadSummary({
      rootDirectory: root,
      trackedSince: "2026-02-01",
      generatedAt,
    });
    assert.equal(
      await publishDownloadStats({
        sourceDirectory: source,
        targetDirectory: target,
      }),
      true,
    );
    await fs.access(path.join(target, "daily", "2026-02-01.json"));
    await fs.access(path.join(target, "summary.json"));
  });
});

function row(overrides = {}) {
  return {
    pluginId: "lapis-docs",
    version: "1.0.0",
    action: "install",
    platform: "web",
    os: "macos",
    count: 1,
    ...overrides,
  };
}

function snapshot(date, rows) {
  return buildDailySnapshot({ date, rows, generatedAt });
}

async function writeDaily(root, value) {
  const filename = path.join(root, "stats", "daily", `${value.date}.json`);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function withTempRoot(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "registry-stats-test-"));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
