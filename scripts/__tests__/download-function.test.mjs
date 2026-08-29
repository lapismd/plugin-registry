import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handleDownloadRequest } from "../../functions/download/[plugin]/[version].js";
import { readJsonc } from "../lib/registry.mjs";

const originUrl =
  "https://github.com/lapis-notes/releases/releases/download/official-plugin-assets-lapis-docs-2026.6.6/lapis-docs-2026.6.6.lapis-plugin";
const targets = {
  schemaVersion: 1,
  targets: {
    "lapis-docs@0.1.0": {
      pluginId: "lapis-docs",
      version: "0.1.0",
      originUrl,
      status: "active",
    },
    "lapis-pending@0.1.0": {
      pluginId: "lapis-pending",
      version: "0.1.0",
      originUrl: "https://example.test/pending.lapis-plugin",
      status: "pending",
    },
    "lapis-revoked@0.1.0": {
      pluginId: "lapis-revoked",
      version: "0.1.0",
      originUrl: "https://example.test/revoked.lapis-plugin",
      status: "revoked",
    },
  },
};

test("GET records normalized dimensions and redirects to the known origin", async () => {
  const points = [];
  const response = handleDownloadRequest(
    context({
      url: "https://registry.example.test/download/lapis-docs/0.1.0?action=install&platform=desktop&os=macos&url=https://evil.test/payload",
      env: {
        PLUGIN_DOWNLOADS: { writeDataPoint: (point) => points.push(point) },
      },
    }),
    targets,
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), originUrl);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(points, [
    {
      indexes: ["lapis-docs@0.1.0"],
      blobs: ["lapis-docs", "0.1.0", "install", "desktop", "macos"],
    },
  ]);
});

test("unknown dimensions are normalized without retaining raw values", () => {
  const points = [];
  const response = handleDownloadRequest(
    context({
      url: "https://registry.example.test/download/lapis-docs/0.1.0?action=side-load&platform=darwin&os=MacIntel",
      env: {
        PLUGIN_DOWNLOADS: { writeDataPoint: (point) => points.push(point) },
      },
    }),
    targets,
  );

  assert.equal(response.status, 302);
  assert.deepEqual(points[0].blobs, [
    "lapis-docs",
    "0.1.0",
    "unknown",
    "unknown",
    "unknown",
  ]);
});

test("HEAD redirects without recording and OPTIONS supplies CORS", () => {
  let writes = 0;
  const env = {
    PLUGIN_DOWNLOADS: { writeDataPoint: () => (writes += 1) },
  };
  const head = handleDownloadRequest(context({ method: "HEAD", env }), targets);
  const options = handleDownloadRequest(
    context({ method: "OPTIONS", env }),
    targets,
  );

  assert.equal(head.status, 302);
  assert.equal(options.status, 204);
  assert.equal(
    options.headers.get("access-control-allow-methods"),
    "GET, HEAD, OPTIONS",
  );
  assert.equal(writes, 0);
});

test("unsupported, unknown, pending, and revoked requests are rejected", async () => {
  const unsupported = handleDownloadRequest(
    context({ method: "POST" }),
    targets,
  );
  const unknown = handleDownloadRequest(
    context({ pluginId: "not-listed" }),
    targets,
  );
  const pending = handleDownloadRequest(
    context({ pluginId: "lapis-pending" }),
    targets,
  );
  const revoked = handleDownloadRequest(
    context({ pluginId: "lapis-revoked" }),
    targets,
  );

  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal(unknown.status, 404);
  assert.equal(pending.status, 404);
  assert.equal(revoked.status, 410);
  assert.equal(await revoked.text(), "Plugin release revoked");
});

test("missing and failing Analytics Engine bindings fail open", () => {
  const missing = handleDownloadRequest(context(), targets);
  const failing = handleDownloadRequest(
    context({
      env: {
        PLUGIN_DOWNLOADS: {
          writeDataPoint: () => {
            throw new Error("dataset unavailable");
          },
        },
      },
    }),
    targets,
  );

  assert.equal(missing.status, 302);
  assert.equal(missing.headers.get("location"), originUrl);
  assert.equal(failing.status, 302);
  assert.equal(failing.headers.get("location"), originUrl);
});

test("Pages routes and bindings keep ordinary registry requests static", async () => {
  const root = new URL("../../", import.meta.url);
  const routes = JSON.parse(
    await readFile(new URL("public/_routes.json", root)),
  );
  const headers = await readFile(new URL("public/_headers", root), "utf8");
  const wrangler = await readJsonc(new URL("wrangler.jsonc", root));

  assert.deepEqual(routes, {
    version: 1,
    include: ["/download/*"],
    exclude: [],
  });
  assert.match(headers, /\/v1\/\*/);
  assert.match(headers, /\/stats\/\*/);
  assert.deepEqual(wrangler.analytics_engine_datasets, [
    {
      binding: "PLUGIN_DOWNLOADS",
      dataset: "lapis_plugin_downloads_v1",
    },
  ]);
});

function context({
  method = "GET",
  url = "https://registry.example.test/download/lapis-docs/0.1.0",
  pluginId = "lapis-docs",
  version = "0.1.0",
  env = {},
} = {}) {
  return {
    request: new Request(url, { method }),
    params: { plugin: pluginId, version },
    env,
  };
}
