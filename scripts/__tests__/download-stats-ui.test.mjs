import assert from "node:assert/strict";
import test from "node:test";

import {
  formatApproximateCount,
  hydrateDirectoryPopularity,
  hydrateDownloadStats,
  hydratePopularPlugins,
  isUsableDownloadSummary,
  loadDownloadStats,
  normalizedBrowserOs,
} from "../../public/download-stats.js";

test("accepts a current summary and rejects absent, malformed, and stale stats", () => {
  const summary = validSummary();
  const current = new Date("2026-02-05T12:00:00.000Z");
  assert.equal(isUsableDownloadSummary(summary, current), true);
  assert.equal(isUsableDownloadSummary(null, current), false);
  assert.equal(
    isUsableDownloadSummary({ ...summary, metric: "unique_users" }, current),
    false,
  );
  assert.equal(
    isUsableDownloadSummary(summary, new Date("2026-02-10T00:00:00.000Z")),
    false,
  );
});

test("formats compact approximate counts deterministically", () => {
  assert.equal(formatApproximateCount(0), "0");
  assert.equal(formatApproximateCount(999), "999");
  assert.equal(formatApproximateCount(1_000), "1K");
  assert.equal(formatApproximateCount(1_250), "1.3K");
  assert.equal(formatApproximateCount(12_500), "13K");
  assert.equal(formatApproximateCount(2_400_000), "2.4M");
  assert.equal(formatApproximateCount(-1), null);
});

test("hydrates list and detail surfaces without changing ordering", () => {
  const count = { dataset: { pluginId: "lapis-docs" }, hidden: true };
  const lifetime = {};
  const recent = {};
  const note = {};
  const values = { hidden: true };
  const unavailable = { hidden: false };
  const detail = {
    dataset: { pluginId: "lapis-docs" },
    querySelector(selector) {
      return {
        "[data-download-lifetime]": lifetime,
        "[data-download-30d]": recent,
        "[data-download-tracked-since]": note,
        "[data-download-stats-values]": values,
        "[data-download-stats-unavailable]": unavailable,
      }[selector];
    },
  };
  const root = {
    querySelectorAll(selector) {
      if (selector.startsWith("[data-download-count]")) return [count];
      if (selector.startsWith("[data-download-detail]")) return [detail];
      return [];
    },
  };

  hydrateDownloadStats(root, validSummary());

  assert.equal(count.textContent, " · ~35 downloads (30d)");
  assert.equal(count.hidden, false);
  assert.equal(lifetime.textContent, "~1.3K");
  assert.equal(recent.textContent, "~35");
  assert.equal(
    note.textContent,
    "Tracked downloads since 2026-01-01. Approximate redirect requests.",
  );
  assert.equal(values.hidden, false);
  assert.equal(unavailable.hidden, true);
});

test("popular plugin hydration keeps its fallback and ranks usable statistics", () => {
  const candidates = ["alpha", "beta", "gamma"].map((pluginId) => ({
    dataset: { pluginId, pluginName: pluginId },
    hidden: false,
  }));
  const list = {
    children: [...candidates],
    querySelectorAll() {
      return [...this.children];
    },
    append(element) {
      this.children = this.children.filter(
        (candidate) => candidate !== element,
      );
      this.children.push(element);
    },
  };
  const lane = {
    attributes: {},
    querySelector() {
      return list;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const root = {
    querySelectorAll(selector) {
      return selector === "[data-popular-lane]" ? [lane] : [];
    },
  };

  hydratePopularPlugins(root, validSummary());
  assert.deepEqual(
    list.children.map((candidate) => candidate.dataset.pluginId),
    ["alpha", "beta", "gamma"],
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.hidden),
    [false, false, false],
  );

  const summary = validSummary();
  summary.periods.lifetime.plugins = {
    alpha: { total: 2, versions: {} },
    beta: { total: 8, versions: {} },
    gamma: { total: 5, versions: {} },
  };
  summary.periods["30d"].plugins = {
    alpha: { total: 2, versions: {} },
    beta: { total: 3, versions: {} },
    gamma: { total: 4, versions: {} },
  };

  hydratePopularPlugins(root, summary);
  assert.deepEqual(
    list.children.map((candidate) => candidate.dataset.pluginId),
    ["gamma", "beta", "alpha"],
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.hidden),
    [false, false, false],
  );
  assert.equal(lane.attributes["aria-busy"], "false");
});

test("directory popularity hydration supplies sort data and signals a resort", () => {
  const rows = ["alpha", "beta"].map((pluginId) => ({
    dataset: { pluginId },
  }));
  const events = [];
  const root = {
    querySelectorAll(selector) {
      return selector === "[data-search-item][data-plugin-id]" ? rows : [];
    },
    dispatchEvent(event) {
      events.push(event.type);
    },
  };
  const summary = validSummary();
  summary.periods.lifetime.plugins = {
    alpha: { total: 20, versions: {} },
    beta: { total: 40, versions: {} },
  };
  summary.periods["30d"].plugins = {
    alpha: { total: 10, versions: {} },
    beta: { total: 5, versions: {} },
  };

  hydrateDirectoryPopularity(root, summary);

  assert.deepEqual(rows[0].dataset, {
    pluginId: "alpha",
    popularityRecent: "10",
    popularityLifetime: "20",
  });
  assert.deepEqual(rows[1].dataset, {
    pluginId: "beta",
    popularityRecent: "5",
    popularityLifetime: "40",
  });
  assert.deepEqual(events, ["lapis-plugin-popularity"]);
});

test("unavailable and malformed summaries leave the page unchanged", async () => {
  const root = {
    querySelectorAll() {
      throw new Error("hydration must not run");
    },
  };
  assert.equal(
    await loadDownloadStats({
      root,
      fetchImpl: async () => new Response("missing", { status: 404 }),
    }),
    false,
  );
  assert.equal(
    await loadDownloadStats({
      root,
      now: new Date("2026-02-05T00:00:00.000Z"),
      fetchImpl: async () => Response.json({ schemaVersion: 1 }),
    }),
    false,
  );
});

test("browser OS detection emits normalized values only", () => {
  assert.equal(normalizedBrowserOs({ platform: "MacIntel" }), "macos");
  assert.equal(
    normalizedBrowserOs({ userAgent: "Mozilla Android" }),
    "android",
  );
  assert.equal(normalizedBrowserOs({ platform: "Win32" }), "windows");
  assert.equal(normalizedBrowserOs({ platform: "Plan9" }), "unknown");
});

function validSummary() {
  return {
    schemaVersion: 1,
    generatedAt: "2026-02-05T04:17:00.000Z",
    dataset: "lapis_plugin_downloads_v1",
    metric: "approximate_redirect_requests",
    trackedSince: "2026-01-01",
    through: "2026-02-03",
    periods: {
      lifetime: period("2026-01-01", 1_250),
      "7d": period("2026-01-28", 12),
      "30d": period("2026-01-05", 35),
    },
  };
}

function period(from, count) {
  return {
    from,
    through: "2026-02-03",
    total: count,
    plugins: { "lapis-docs": { total: count, versions: { "1.0.0": count } } },
    versions: { "lapis-docs@1.0.0": count },
    actions: { install: count },
    platforms: { web: count },
    os: { macos: count },
  };
}
