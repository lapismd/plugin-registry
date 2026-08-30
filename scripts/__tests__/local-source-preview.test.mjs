import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLocalSourcePreview } from "../lib/local-source-preview.mjs";

test("local source preview overlays unsigned manifest and registry-only content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-registry-preview-"));
  const sourceDir = path.join(root, "source");
  const baseRegistryDir = path.join(root, "base", "v1");
  const outputDir = path.join(root, "preview", "v1");
  await mkdir(path.join(sourceDir, "registry-content"), { recursive: true });
  await mkdir(path.join(baseRegistryDir, "plugins"), { recursive: true });

  await writeJson(path.join(sourceDir, "registry.json"), {
    schemaVersion: 1,
    categories: ["productivity"],
    highlights: ["Keeps end-user registry copy separate from package docs."],
    content: {
      overview: "registry-content/overview.md",
      changelog: "CHANGELOG.md",
    },
  });
  await writeJson(path.join(sourceDir, "package.json"), {
    name: "@example/plugin",
    version: "1.1.0",
    license: "MIT",
    repository: "https://github.com/example/plugins.git",
  });
  await writeJson(path.join(sourceDir, "manifest.json"), {
    id: "example-plugin",
    name: "Example Plugin",
    version: "1.1.0",
    minAppVersion: "0.1.0",
    description: "Updated local manifest description.",
    author: "Example",
    isDesktopOnly: false,
  });
  await writeFile(
    path.join(sourceDir, "registry-content", "overview.md"),
    "# Example Plugin\n\nEnd-user registry information.\n",
  );
  await writeFile(path.join(sourceDir, "CHANGELOG.md"), "# Changelog\n");
  await writeFile(
    path.join(sourceDir, "README.md"),
    "# Package docs\n\npnpm add @example/plugin\n",
  );
  await writeFile(path.join(baseRegistryDir, "index.sig"), "stale signature\n");

  const result = await buildLocalSourcePreview({
    sourceDir,
    outputDir,
    baseRegistryDir,
    registryBaseUrl: "http://localhost:4321/v1/",
    entries: [catalogEntry()],
  });

  assert.deepEqual(result.updatedPluginIds, ["example-plugin"]);
  assert.equal(result.unsigned, true);
  const index = await readJson(path.join(outputDir, "index.json"));
  assert.equal(index.plugins[0].latestVersion, "1.1.0");
  assert.deepEqual(index.plugins[0].platforms, ["web", "desktop"]);
  assert.equal(
    index.plugins[0].description,
    "Updated local manifest description.",
  );
  const detail = await readJson(
    path.join(outputDir, "plugins", "example-plugin.json"),
  );
  assert.equal(detail.latestVersion, "1.1.0");
  assert.equal(detail.versions["1.1.0"].bundle.pending, true);
  assert.equal(detail.versions["1.1.0"].bundle.size, 0);
  assert.equal(detail.versions["1.0.0"].bundle.pending, undefined);
  assert.match(
    detail.content.overview.sourceUrl,
    /registry-content\/overview\.md$/,
  );
  assert.equal(
    await readFile(
      path.join(outputDir, "content", "example-plugin", "overview.md"),
      "utf8",
    ),
    "# Example Plugin\n\nEnd-user registry information.\n",
  );
  await assert.rejects(access(path.join(outputDir, "index.sig")));

  await rm(root, { recursive: true, force: true });
});

function catalogEntry() {
  return {
    schemaVersion: 1,
    id: "example-plugin",
    name: "Published name",
    description: "Published description.",
    author: "Example",
    channel: "community",
    status: "active",
    latestVersion: "1.0.0",
    minAppVersion: "0.1.0",
    platforms: ["web", "desktop"],
    categories: ["productivity"],
    owner: { name: "Example", verified: false },
    source: {
      repository: "example/plugins",
      packageName: "@example/plugin",
      sourceCommit: "a".repeat(40),
      metadataPath: "registry.json",
    },
    versions: {
      "1.0.0": {
        version: "1.0.0",
        minAppVersion: "0.1.0",
        releasedAt: "2026-08-30T00:00:00.000Z",
        platforms: ["web", "desktop"],
        bundle: {
          url: "https://example.test/example-plugin-1.0.0.lapis-plugin",
          sha256: "a".repeat(64),
          size: 100,
        },
      },
    },
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
