import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const dist = new URL("../../dist/", import.meta.url);

test("site build emits pages and registry metadata", async () => {
  if (
    !existsSync(new URL("index.html", dist)) ||
    !existsSync(new URL("v1/readmes/lapis-graph/README.html", dist)) ||
    !existsSync(new URL("_routes.json", dist)) ||
    !existsSync(new URL("download-stats.js", dist))
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
    "plugins/lapis-docs/index.html",
    "v1/index.json",
    "v1/index.sig",
    "v1/plugins/lapis-docs.json",
    "v1/plugins/lapis-docs.sig",
    "v1/readmes/lapis-graph/README.md",
    "v1/readmes/lapis-graph/README.html",
    "v1/readmes/lapis-graph/manifest.json",
    "v1/trust/root.json",
    "_routes.json",
    "_headers",
    "download-stats.js",
  ];

  for (const file of requiredFiles) {
    assert.equal(existsSync(new URL(file, dist)), true, `${file} should exist`);
  }

  const detail = await readFile(
    new URL("plugins/lapis-docs/index.html", dist),
    "utf8",
  );
  assert.match(detail, /Signed bundle/);
  assert.match(detail, /Download \.lapis-plugin/);
  assert.match(detail, /Bundle size/);
  assert.match(detail, /\*\.lapisdoc/);
  assert.match(detail, /data-download-detail/);
  assert.match(detail, /data-download-link/);
  assert.doesNotMatch(detail, /data-plugin-readme/);
  assert.doesNotMatch(detail, /View source README/);
  assert.doesNotMatch(detail, /Loading README/);
  assert.doesNotMatch(detail, /fetch\(endpoint/);

  const graphDetail = await readFile(
    new URL("plugins/lapis-graph/index.html", dist),
    "utf8",
  );
  assert.match(graphDetail, /data-plugin-readme/);
  assert.match(graphDetail, /View source README/);

  const listing = await readFile(new URL("plugins/index.html", dist), "utf8");
  const names = [...listing.matchAll(/data-name="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  assert.doesNotMatch(listing, /data-sort-value="(?:downloads|popularity)"/);

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
