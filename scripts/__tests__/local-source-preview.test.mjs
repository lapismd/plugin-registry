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
import sharp from "sharp";

import { buildLocalSourcePreview } from "../lib/local-source-preview.mjs";

test("local source preview overlays unsigned manifest and registry-only content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-registry-preview-"));
  const sourceDir = path.join(root, "source");
  const baseRegistryDir = path.join(root, "base", "v1");
  const outputDir = path.join(root, "preview", "v1");
  await mkdir(path.join(sourceDir, "registry-content"), { recursive: true });
  await mkdir(path.join(sourceDir, "registry-assets", "gallery"), {
    recursive: true,
  });
  await mkdir(path.join(baseRegistryDir, "plugins"), { recursive: true });

  const previewImage = await image(1200, 800);
  const fullImage = await image(2400, 1600);

  await writeJson(path.join(sourceDir, "registry.json"), {
    schemaVersion: 1,
    categories: ["productivity"],
    highlights: ["Keeps end-user registry copy separate from package docs."],
    gallery: [
      {
        id: "workspace",
        alt: "Example Plugin displayed in the Lapis workspace.",
        images: {
          preview: {
            path: "registry-assets/gallery/workspace.preview.webp",
          },
          full: { path: "registry-assets/gallery/workspace.full.webp" },
        },
        capture: {
          storyId: "plugins-example-registry-screenshots--workspace",
          focus: "full-shell",
        },
        card: {
          headline: [{ text: "Focused example", tone: "violet" }],
          description: [
            { text: "Registry-only copy", tone: "cyan" },
            {
              text: "stays out of package installation docs.",
              tone: "neutral",
            },
          ],
        },
      },
    ],
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
    path.join(
      sourceDir,
      "registry-assets",
      "gallery",
      "workspace.preview.webp",
    ),
    previewImage,
  );
  await writeFile(
    path.join(sourceDir, "registry-assets", "gallery", "workspace.full.webp"),
    fullImage,
  );
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
  assert.deepEqual(Object.keys(detail.gallery[0]).sort(), [
    "alt",
    "id",
    "images",
  ]);
  assert.equal(detail.gallery[0].images.preview.width, 1200);
  assert.equal(detail.gallery[0].images.preview.height, 800);
  assert.equal(detail.gallery[0].images.full.width, 2400);
  assert.equal(detail.gallery[0].images.full.height, 1600);
  for (const [variant, sourceBytes] of [
    ["preview", previewImage],
    ["full", fullImage],
  ]) {
    const reference = detail.gallery[0].images[variant];
    assert.equal(reference.mediaType, "image/webp");
    assert.equal(reference.size, sourceBytes.byteLength);
    const mirroredName = new URL(reference.url).pathname.split("/").at(-1);
    assert.deepEqual(
      await readFile(
        path.join(outputDir, "assets", "example-plugin", mirroredName),
      ),
      sourceBytes,
    );
  }
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

function image(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 139, g: 92, b: 246, alpha: 1 },
    },
  })
    .webp({ lossless: true })
    .toBuffer();
}
