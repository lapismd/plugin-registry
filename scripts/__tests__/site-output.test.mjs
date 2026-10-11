import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = new URL("../../", import.meta.url);
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

test("site build emits signed V2 pages and retains the V1 archive", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "lapis-registry-v2-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const generated = path.join(fixture, "generated");
  const dist = pathToFileURL(`${fixture}/dist/`);
  const env = {
    ...process.env,
    LAPIS_REGISTRY_GENERATED_DIR: pathToFileURL(`${generated}/`).href,
    LAPIS_REGISTRY_DIST_DIR: dist.href,
  };
  await mkdir(path.join(generated, "plugins"), { recursive: true });
  await writeFile(path.join(generated, "plugins/removed.json"), "{}");
  await writeFile(path.join(generated, "plugins/removed.sig"), "{}");
  const { privateKey } = generateKeyPairSync("ed25519");
  env.LAPIS_REGISTRY_KEY_ID = "lapis-registry-test";
  env.LAPIS_REGISTRY_PRIVATE_KEY_PEM = privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
  for (const script of [
    "generate-registry",
    "sign-registry",
    "verify-signatures",
    "build-site",
  ]) {
    const result = spawnSync(process.execPath, [`scripts/${script}.mjs`], {
      cwd: root.pathname,
      env,
      stdio: "inherit",
    });
    assert.equal(result.status, 0, `${script} succeeds`);
  }
  assert.equal(existsSync(path.join(generated, "plugins/removed.json")), false);
  assert.equal(existsSync(path.join(generated, "plugins/removed.sig")), false);
  assert.deepEqual(
    await readFile(new URL("v1/index.json", dist)),
    await readFile(new URL("../../generated/v1/index.json", import.meta.url)),
  );

  const requiredFiles = [
    "index.html",
    "plugins/index.html",
    "v2/index.json",
    "v2/index.sig",
    "v2/trust/root.json",
    "_routes.json",
    "_headers",
    "download-stats.js",
    ...expectedPluginIds.flatMap((pluginId) => [
      `plugins/${pluginId}/index.html`,
      `v2/plugins/${pluginId}.json`,
      `v2/plugins/${pluginId}.sig`,
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
      existsSync(new URL(`v2/plugins/${pluginId}.json`, dist)),
      false,
      `${pluginId} metadata should not exist`,
    );
    assert.equal(
      existsSync(new URL(`v2/plugins/${pluginId}.sig`, dist)),
      false,
      `${pluginId} signature should not exist`,
    );
  }

  const index = JSON.parse(
    await readFile(new URL("v2/index.json", dist), "utf8"),
  );
  assert.equal(index.schemaVersion, 2);
  const homepage = await readFile(new URL("index.html", dist), "utf8");
  assert.match(homepage, /href="\/v2\/index\.json"/);
  assert.match(homepage, /href="\/v2\/trust\/root\.json"/);
  assert.equal(existsSync(new URL("v2/content/", dist)), false);
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
  assert.match(
    detail,
    /href="\/download\/ai\/0\.1\.2\?action=download(?:&amp;|&)platform=web(?:&amp;|&)os=unknown"[^>]*data-download-link/,
  );
  assert.match(detail, /data-plugin-overview/);
  assert.match(detail, /data-plugin-changelog/);
  assert.match(detail, /Documentation/);
  assert.doesNotMatch(detail, /Loading README/);
  assert.doesNotMatch(detail, /fetch\(endpoint/);
  assert.doesNotMatch(detail, /Registry health/);
  assert.doesNotMatch(detail, /<dt>Links<\/dt>/);
  assert.match(detail, /data-action-menu-trigger/);
  assert.match(detail, /data-action-menu-popover/);
  assert.match(detail, /data-overview-collapse/);
  assert.match(
    detail,
    /data-overview-toggle[^>]*>[\s\S]*?Show more[\s\S]*?<\/button>/,
  );
  assert.match(detail, />\s*Homepage\s*<\/a>/);
  assert.match(detail, />\s*Report bug\s*<\/a>/);
  assert.match(detail, />\s*Request feature\s*<\/a>/);
  assert.match(detail, />\s*View repository\s*<\/a>/);
  assert.match(detail, /class="plugin-identity plugin-identity--hero"/);
  assert.match(detail, /aria-label="Breadcrumb"/);
  assert.match(detail, /href="\/plugins\/\?categories=productivity"/);

  const listing = await readFile(new URL("plugins/index.html", dist), "utf8");
  const names = [...listing.matchAll(/data-name="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  assert.match(listing, /data-sort-value="popular"/);
  assert.match(listing, /data-sort-value="new"/);
  assert.match(listing, /data-sort-value="updated"/);
  assert.doesNotMatch(listing, /data-sort-value="downloads"/);
  assert.match(listing, /data-filter-category="ai" data-filter-label="AI"/);
  assert.doesNotMatch(listing, /data-filter-label="Ai"/);
  assert.match(listing, /class="lucide lucide-chevrons-up-down sort-chevrons"/);
  assert.doesNotMatch(listing, /<span class="sort-chevrons"/);
  assert.match(listing, /data-result-list data-view="grid"/);
  assert.match(listing, /class="lucide lucide-list"/);
  assert.match(listing, /class="lucide lucide-layout-grid"/);
  assert.match(listing, /data-category-toggle/);
  assert.match(listing, /data-category-extra="true"/);

  const landing = await readFile(new URL("index.html", dist), "utf8");
  assert.match(landing, /Make Lapis Notes yours\./);
  assert.match(landing, /class="site-brand__accent">Notes<\/span>/);
  assert.match(landing, /data-popular-lane aria-busy="false"/);
  assert.match(landing, /href="\/plugins\/\?sort=popular"/);
  assert.match(landing, /href="\/plugins\/\?sort=new"/);
  assert.match(landing, /href="\/plugins\/\?sort=updated"/);
  assert.match(landing, />Popular<\/span>/);
  assert.match(landing, />New<\/span>/);
  assert.match(landing, />Updated<\/span>/);
  assert.match(landing, /class="home-category-grid"/);
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
  assert.match(headers, /\/v2\/\*/);
  assert.match(headers, /\/stats\/\*/);

  if (existsSync(new URL("../../stats/summary.json", import.meta.url))) {
    assert.equal(existsSync(new URL("stats/summary.json", dist)), true);
  }
});
