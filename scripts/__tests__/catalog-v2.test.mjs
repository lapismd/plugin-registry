import assert from "node:assert/strict";
import test from "node:test";
import { buildRegistryV2 } from "../lib/catalog-v2.mjs";

test("V2 derives listing compatibility from the immutable latest release and drops legacy content", () => {
  const entry = {
    id: "lapis-graph",
    name: "Graph",
    description: "Relationships",
    author: "Lapis",
    channel: "official",
    status: "active",
    owner: { name: "Lapis", verified: true },
    latestVersion: "1.0.0",
    minAppVersion: "99.0.0",
    platforms: ["electron"],
    categories: ["graph"],
    readmeUrl: "https://example.com/docs",
    content: { overview: {} },
    versions: {
      "1.0.0": {
        version: "1.0.0",
        minAppVersion: "0.1.0",
        platforms: ["web", "desktop"],
        releasedAt: "2026-10-11T00:00:00Z",
        changelog: { title: "Graphs", tags: ["feature"] },
        bundle: {
          url: "https://example.com/graph.lapis-plugin",
          sha256: "a".repeat(64),
          size: 100,
        },
      },
    },
  };
  const built = buildRegistryV2([entry]);
  assert.equal(built.index.schemaVersion, 2);
  assert.equal(built.index.plugins[0].minAppVersion, "0.1.0");
  assert.deepEqual(built.index.plugins[0].platforms, ["web", "desktop"]);
  assert.equal(built.index.plugins[0].links.documentation, entry.readmeUrl);
  assert.equal(built.details[entry.id].links.documentation, entry.readmeUrl);
  assert.equal(
    built.details[entry.id].versions["1.0.0"].bundle.sha256,
    entry.versions["1.0.0"].bundle.sha256,
  );
  assert.equal(
    built.details[entry.id].versions["1.0.0"].changelog.title,
    "Graphs",
  );
  assert.equal(
    built.details[entry.id].versions["1.0.0"].bundle.downloadUrl,
    "../../download/lapis-graph/1.0.0",
  );
  assert.equal(
    built.downloadTargets.targets["lapis-graph@1.0.0"].originUrl,
    entry.versions["1.0.0"].bundle.url,
  );
  assert.equal("content" in built.details[entry.id], false);
  assert.equal("readmeUrl" in built.index.plugins[0], false);
});
