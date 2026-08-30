import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const dist = new URL("../../dist/", import.meta.url);
const expectedPluginIds = [
  "ai",
  "bases",
  "bookmarks",
  "history",
  "lapis-graph",
  "lapis-markdown-lint",
  "lapis-source-editor",
  "markdown",
  "search",
  "spellcheck",
  "wordcount",
];
const removedPluginIds = [
  "lapis-canvas",
  "lapis-docs",
  "lapis-notebook",
  "lapis-pdf",
  "lapis-slides",
  "lapis-telemetry",
];

test("site build emits pages and registry metadata", async () => {
  if (
    !existsSync(new URL("index.html", dist)) ||
    !existsSync(new URL("v1/content/ai/overview.md", dist)) ||
    !existsSync(new URL("_routes.json", dist)) ||
    !existsSync(new URL("download-stats.js", dist)) ||
    expectedPluginIds.some(
      (pluginId) =>
        !existsSync(new URL(`plugins/${pluginId}/index.html`, dist)),
    ) ||
    removedPluginIds.some((pluginId) =>
      existsSync(new URL(`plugins/${pluginId}/index.html`, dist)),
    )
  ) {
    const result = spawnSync("pnpm", ["site:build"], {
      cwd: root.pathname,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    assert.equal(result.status, 0);
  }

  const requiredFiles = [
    "index.html",
    "plugins/index.html",
    "v1/index.json",
    "v1/index.sig",
    "v1/content/ai/overview.md",
    "v1/content/ai/changelog.md",
    "v1/trust/root.json",
    "_routes.json",
    "_headers",
    "download-stats.js",
    ...expectedPluginIds.flatMap((pluginId) => [
      `plugins/${pluginId}/index.html`,
      `v1/plugins/${pluginId}.json`,
      `v1/plugins/${pluginId}.sig`,
    ]),
  ];

  for (const file of requiredFiles) {
    assert.equal(existsSync(new URL(file, dist)), true, `${file} should exist`);
  }

  for (const pluginId of removedPluginIds) {
    assert.equal(
      existsSync(new URL(`plugins/${pluginId}/index.html`, dist)),
      false,
      `${pluginId} page should not exist`,
    );
    assert.equal(
      existsSync(new URL(`v1/plugins/${pluginId}.json`, dist)),
      false,
      `${pluginId} metadata should not exist`,
    );
    assert.equal(
      existsSync(new URL(`v1/plugins/${pluginId}.sig`, dist)),
      false,
      `${pluginId} signature should not exist`,
    );
  }

  const index = JSON.parse(
    await readFile(new URL("v1/index.json", dist), "utf8"),
  );
  assert.deepEqual(
    index.plugins.map((plugin) => plugin.id).sort(),
    expectedPluginIds,
  );

  const detail = await readFile(new URL("plugins/ai/index.html", dist), "utf8");
  assert.match(detail, /Signed bundle/);
  assert.match(detail, /Download \.lapis-plugin/);
  assert.match(detail, /Bundle size/);
  assert.match(detail, /data-download-detail/);
  assert.match(detail, /data-download-stats-values hidden/);
  assert.match(detail, /Statistics unavailable/);
  assert.match(detail, /data-download-link/);
  assert.match(detail, /data-plugin-readme/);
  assert.match(detail, /data-plugin-changelog/);
  assert.match(detail, /View source overview/);
  assert.doesNotMatch(detail, /Loading README/);
  assert.doesNotMatch(detail, /fetch\(endpoint/);
  assert.match(detail, /class="detail-links"/);
  assert.match(detail, />Documentation<\/a>/);
  assert.match(detail, />Homepage<\/a>/);
  assert.match(detail, />Issues<\/a>/);
  assert.match(detail, />Repository<\/a>/);
  assert.match(detail, /class="plugin-identity plugin-identity--hero"/);

  const listing = await readFile(new URL("plugins/index.html", dist), "utf8");
  const names = [...listing.matchAll(/data-name="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  assert.doesNotMatch(listing, /data-sort-value="(?:downloads|popularity)"/);
  assert.match(listing, /data-filter-category="ai" data-filter-label="AI"/);
  assert.doesNotMatch(listing, /data-filter-label="Ai"/);
  assert.match(listing, /class="lucide lucide-chevrons-up-down sort-chevrons"/);
  assert.doesNotMatch(listing, /<span class="sort-chevrons"/);

  const landing = await readFile(new URL("index.html", dist), "utf8");
  assert.match(landing, />New<\/h2>/);
  assert.match(landing, />Updated<\/h2>/);
  assert.match(landing, /data-popular-lane hidden aria-busy="true"/);
  assert.match(landing, />Popular<\/h2>/);
  assert.match(landing, />Developers<\/h2>/);
  assert.match(landing, />Registry schemas<\/a>/);
  assert.match(landing, />LapisMD on GitHub<\/a>/);

  const routes = JSON.parse(
    await readFile(new URL("_routes.json", dist), "utf8"),
  );
  assert.deepEqual(routes, {
    version: 1,
    include: ["/download/*"],
    exclude: [],
  });
  const headers = await readFile(new URL("_headers", dist), "utf8");
  assert.match(headers, /\/v1\/\*/);
  assert.match(headers, /\/stats\/\*/);

  if (existsSync(new URL("../../stats/summary.json", import.meta.url))) {
    assert.equal(existsSync(new URL("stats/summary.json", dist)), true);
  }
});
