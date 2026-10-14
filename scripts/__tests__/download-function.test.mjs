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
const archiveFetch = async () => new Response(new Uint8Array([1, 2, 3]));

test("GET streams the pinned archive with CORS instead of redirecting the browser", async () => {
  let controller;
  const stream = new ReadableStream({
    start(value) {
      controller = value;
    },
  });
  const requests = [];
  const response = await handleDownloadRequest(
    context({
      url: "https://registry.example.test/download/lapis-docs/0.1.0?url=https://evil.test/archive",
    }),
    targets,
    async (url, init) => {
      requests.push({ url, init });
      return new Response(stream);
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, originUrl);
  assert.equal(requests[0].init.method, "GET");
  controller.enqueue(new Uint8Array([1, 2, 3]));
  controller.close();
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
});

test("upstream failures return a CORS-readable gateway error without a redirect", async () => {
  const response = await handleDownloadRequest(
    context(),
    targets,
    async () => new Response("unavailable", { status: 503 }),
  );
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("GET records normalized dimensions and delivers the known origin", async () => {
  const points = [];
  const response = await handleDownloadRequest(
    context({
      url: "https://registry.example.test/download/lapis-docs/0.1.0?action=install&platform=desktop&os=macos&url=https://evil.test/payload",
      env: {
        PLUGIN_DOWNLOADS: { writeDataPoint: (point) => points.push(point) },
      },
    }),
    targets,
    archiveFetch,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
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

test("unknown dimensions are normalized without retaining raw values", async () => {
  const points = [];
  const response = await handleDownloadRequest(
    context({
      url: "https://registry.example.test/download/lapis-docs/0.1.0?action=side-load&platform=darwin&os=MacIntel",
      env: {
        PLUGIN_DOWNLOADS: { writeDataPoint: (point) => points.push(point) },
      },
    }),
    targets,
    archiveFetch,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(points[0].blobs, [
    "lapis-docs",
    "0.1.0",
    "unknown",
    "unknown",
    "unknown",
  ]);
});

test("HEAD delivers headers without recording and OPTIONS supplies CORS", async () => {
  let writes = 0;
  const env = {
    PLUGIN_DOWNLOADS: { writeDataPoint: () => (writes += 1) },
  };
  const head = await handleDownloadRequest(
    context({ method: "HEAD", env }),
    targets,
    archiveFetch,
  );
  const options = await handleDownloadRequest(
    context({ method: "OPTIONS", env }),
    targets,
    archiveFetch,
  );

  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(options.status, 204);
  assert.equal(
    options.headers.get("access-control-allow-methods"),
    "GET, HEAD, OPTIONS",
  );
  assert.equal(writes, 0);
});

test("unsupported, unknown, pending, and revoked requests are rejected", async () => {
  const unsupported = await handleDownloadRequest(
    context({ method: "POST" }),
    targets,
    archiveFetch,
  );
  const unknown = await handleDownloadRequest(
    context({ pluginId: "not-listed" }),
    targets,
    archiveFetch,
  );
  const pending = await handleDownloadRequest(
    context({ pluginId: "lapis-pending" }),
    targets,
    archiveFetch,
  );
  const revoked = await handleDownloadRequest(
    context({ pluginId: "lapis-revoked" }),
    targets,
    archiveFetch,
  );

  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal(unknown.status, 404);
  assert.equal(pending.status, 404);
  assert.equal(revoked.status, 410);
  assert.equal(await revoked.text(), "Plugin release revoked");
});

test("missing and failing Analytics Engine bindings fail open", async () => {
  const missing = await handleDownloadRequest(context(), targets, archiveFetch);
  const failing = await handleDownloadRequest(
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
    archiveFetch,
  );

  assert.equal(missing.status, 200);
  assert.equal(failing.status, 200);
  assert.deepEqual(
    new Uint8Array(await missing.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
  assert.deepEqual(
    new Uint8Array(await failing.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
});

test("upstream requests never forward browser credentials or query parameters", async () => {
  const ctx = context({
    url: "https://registry.example.test/download/lapis-docs/0.1.0?token=private&url=https://evil.test",
  });
  ctx.request = new Request(ctx.request, {
    headers: { Authorization: "Bearer private", Cookie: "session=private" },
  });
  const response = await handleDownloadRequest(
    ctx,
    targets,
    async (url, init) => {
      assert.equal(url, originUrl);
      assert.deepEqual(Object.keys(init).sort(), [
        "method",
        "redirect",
        "signal",
      ]);
      assert.equal(init.signal, ctx.request.signal);
      return archiveFetch();
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("network errors remain CORS-readable and unknown targets never fetch", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    throw new TypeError("Fetch failed");
  };
  const missing = await handleDownloadRequest(
    context({ pluginId: "not-listed" }),
    targets,
    fetchImpl,
  );
  assert.equal(missing.status, 404);
  assert.equal(requests, 0);
  const failed = await handleDownloadRequest(context(), targets, fetchImpl);
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get("access-control-allow-origin"), "*");
  assert.equal(requests, 1);
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
