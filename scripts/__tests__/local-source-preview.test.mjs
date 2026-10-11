import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";

import { buildLocalSourcePreview } from "../lib/local-source-preview.mjs";
import { pendingLocalSourceEntries } from "../lib/preview-source-entries.mjs";
import {
  isLocalSourcePreviewInput,
  refreshLocalSourcePreview,
  watchLocalSourcePreview,
} from "../lib/local-source-preview-dev.mjs";

test("local source preview overlays unsigned manifest and registry-only content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-registry-preview-"));
  const sourceDir = path.join(root, "source");
  const baseRegistryDir = path.join(root, "base", "v1");
  const outputDir = path.join(root, "preview", "v1");
  const { previewImage, fullImage } = await writeSourceFixture({
    sourceDir,
    baseRegistryDir,
  });

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
  assert.equal(index.schemaVersion, 2);
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
  assert.equal(detail.appearance.logo.images.full.width, 128);
  assert.equal(detail.appearance.logo.images.full.height, 128);
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
  assert.match(detail.links.documentation, /registry-content\/overview\.md$/);
  assert.equal(detail.content, undefined);
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

test("V2 local preview preserves banner media and leaves the production catalog intact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-registry-v2-preview-"));
  const sourceDir = path.join(root, "source");
  const baseRegistryDir = path.join(root, "base");
  const outputDir = path.join(root, "preview");
  await writeSourceFixture({ sourceDir, baseRegistryDir });
  const source = registrySource();
  source.schemaVersion = 2;
  delete source.content;
  source.media = {
    banner: { alt: "Example banner", images: source.gallery[0].images },
  };
  await writeJson(path.join(sourceDir, "registry.json"), source);
  await writeFile(
    path.join(sourceDir, "CHANGELOG.md"),
    "# Changelog\n\n## 1.1.0\n\nNew banner media.\n",
  );
  const productionBytes = Buffer.from('{"schemaVersion":1,"plugins":[]}\n');
  await writeFile(path.join(baseRegistryDir, "index.json"), productionBytes);
  await buildLocalSourcePreview({
    sourceDir,
    outputDir,
    baseRegistryDir,
    entries: [catalogEntry()],
  });
  const detail = await readJson(
    path.join(outputDir, "plugins", "example-plugin.json"),
  );
  assert.equal(detail.media.banner.alt, "Example banner");
  assert.equal(detail.media.banner.images.full.width, 2400);
  assert.equal(detail.media.banner.images.full.height, 1600);
  assert.equal(detail.content, undefined);
  assert.equal(
    detail.versions["1.1.0"].changelog.title,
    "Example Plugin 1.1.0",
  );
  assert.deepEqual(
    await readFile(path.join(baseRegistryDir, "index.json")),
    productionBytes,
  );
  assert.equal(
    await readFile(path.join(baseRegistryDir, "index.sig"), "utf8"),
    "stale signature\n",
  );
  await rm(root, { recursive: true, force: true });
});

test("local-only discovery includes Community and Slides as pending without changing source files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-registry-discovery-"));
  for (const [slug, id] of [
    ["community", "community"],
    ["slides", "lapis-slides"],
  ]) {
    const packageRoot = path.join(root, "packages", slug);
    await mkdir(packageRoot, { recursive: true });
    await writeJson(path.join(packageRoot, "registry.json"), {
      schemaVersion: 2,
    });
    await writeJson(path.join(packageRoot, "manifest.json"), {
      id,
      name: slug,
      version: "0.1.0",
      description: `${slug} plugin`,
      author: "Lapis Notes",
    });
    await writeJson(path.join(packageRoot, "package.json"), {
      name: `@lapis-notes/${slug}`,
      repository: "https://github.com/lapismd/lapis-plugins.git",
    });
  }
  const manifestPath = path.join(
    root,
    "packages",
    "community",
    "manifest.json",
  );
  const before = await readFile(manifestPath);
  const entries = await pendingLocalSourceEntries(root, []);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["community", "lapis-slides"],
  );
  for (const entry of entries) {
    assert.equal(entry.status, "pending");
    assert.equal(entry.versions["0.1.0"].bundle.pending, true);
    assert.equal(entry.versions["0.1.0"].bundle.size, 0);
  }
  assert.deepEqual(
    (await pendingLocalSourceEntries(root, [{ id: "community" }])).map(
      (entry) => entry.id,
    ),
    ["lapis-slides"],
  );
  assert.deepEqual(await readFile(manifestPath), before);
  await rm(root, { recursive: true, force: true });
});

test("local source refresh publishes complete snapshots and retains the last valid preview", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-registry-refresh-"));
  const sourceDir = path.join(root, "source");
  const baseRegistryDir = path.join(root, "base", "v1");
  const outputDir = path.join(root, "preview", "v1");
  const stagingDir = path.join(root, "preview", "staging");
  await writeSourceFixture({ sourceDir, baseRegistryDir });

  await refreshLocalSourcePreview({
    sourceDir,
    outputDir,
    stagingDir,
    baseRegistryDir,
    registryBaseUrl: "http://localhost:4321/v1/",
    entries: [catalogEntry()],
  });
  const detailPath = path.join(outputDir, "plugins", "example-plugin.json");
  const initialDetail = await readFile(detailPath);
  const initialIndex = await readFile(path.join(outputDir, "index.json"));

  await writeFile(path.join(sourceDir, "registry.json"), "{\n");
  await assert.rejects(
    refreshLocalSourcePreview({
      sourceDir,
      outputDir,
      stagingDir,
      baseRegistryDir,
      registryBaseUrl: "http://localhost:4321/v1/",
      entries: [catalogEntry()],
    }),
    /JSON/,
  );
  assert.deepEqual(await readFile(detailPath), initialDetail);
  assert.deepEqual(
    await readFile(path.join(outputDir, "index.json")),
    initialIndex,
  );

  const updatedAlt =
    "Updated Example Plugin preview from the running source tree.";
  const updatedPreviewImage = await image(1200, 800, {
    r: 34,
    g: 211,
    b: 238,
    alpha: 1,
  });
  const updatedLogo = await image(128, 128, {
    r: 16,
    g: 185,
    b: 129,
    alpha: 1,
  });
  const updatedManifest = await readJson(path.join(sourceDir, "manifest.json"));
  updatedManifest.description = "Live manifest description from source.";
  await writeJson(
    path.join(sourceDir, "registry.json"),
    registrySource(updatedAlt),
  );
  await writeJson(path.join(sourceDir, "manifest.json"), updatedManifest);
  await writeFile(
    path.join(sourceDir, "registry-content", "overview.md"),
    "# Updated Example Plugin\n\nLive registry copy from source.\n",
  );
  await writeFile(
    path.join(sourceDir, "registry-assets", "logo.webp"),
    updatedLogo,
  );
  await writeFile(
    path.join(
      sourceDir,
      "registry-assets",
      "gallery",
      "workspace.preview.webp",
    ),
    updatedPreviewImage,
  );
  await refreshLocalSourcePreview({
    sourceDir,
    outputDir,
    stagingDir,
    baseRegistryDir,
    registryBaseUrl: "http://localhost:4321/v1/",
    entries: [catalogEntry()],
  });

  const updatedDetail = await readJson(detailPath);
  const updatedReference = updatedDetail.gallery[0].images.preview;
  const updatedIndex = await readJson(path.join(outputDir, "index.json"));
  assert.equal(updatedDetail.gallery[0].alt, updatedAlt);
  assert.equal(
    updatedIndex.plugins[0].description,
    "Live manifest description from source.",
  );
  assert.equal(
    updatedDetail.appearance.logo.images.full.sha256,
    sha256(updatedLogo),
  );
  assert.equal(updatedReference.sha256, sha256(updatedPreviewImage));
  assert.equal(
    await readFile(
      path.join(outputDir, "content", "example-plugin", "overview.md"),
      "utf8",
    ),
    "# Updated Example Plugin\n\nLive registry copy from source.\n",
  );
  assert.deepEqual(
    await readFile(
      path.join(
        outputDir,
        "assets",
        "example-plugin",
        new URL(updatedDetail.appearance.logo.images.full.url).pathname
          .split("/")
          .at(-1),
      ),
    ),
    updatedLogo,
  );
  assert.deepEqual(
    await readFile(
      path.join(
        outputDir,
        "assets",
        "example-plugin",
        new URL(updatedReference.url).pathname.split("/").at(-1),
      ),
    ),
    updatedPreviewImage,
  );
  assert.deepEqual(await readdir(stagingDir), []);
  await assert.rejects(access(path.join(outputDir, "index.sig")));

  await rm(root, { recursive: true, force: true });
});

test("local source watcher filters inputs, debounces bursts, and serializes refreshes", async () => {
  const fakeWatcher = new FakeWatcher();
  const firstRefresh = deferred();
  const refreshedPaths = [];
  let activeRefreshes = 0;
  let maximumActiveRefreshes = 0;
  let rejectNextRefresh = false;
  let refreshCount = 0;
  const refreshErrors = [];
  const watcher = watchLocalSourcePreview({
    sourceDir: "/tmp/local-source-preview-fixture",
    debounceMs: 5,
    watchFactory: (_sourceDir, options, listener) => {
      assert.equal(options.recursive, true);
      fakeWatcher.listener = listener;
      return fakeWatcher;
    },
    refresh: async (changedPaths) => {
      refreshCount += 1;
      activeRefreshes += 1;
      maximumActiveRefreshes = Math.max(
        maximumActiveRefreshes,
        activeRefreshes,
      );
      refreshedPaths.push(changedPaths);
      try {
        if (refreshCount === 1) await firstRefresh.promise;
        if (rejectNextRefresh) {
          rejectNextRefresh = false;
          throw new Error("Invalid intermediate source metadata.");
        }
        return { updatedPluginIds: ["example-plugin"] };
      } finally {
        activeRefreshes -= 1;
      }
    },
    onError: (error) => refreshErrors.push(error.message),
  });

  fakeWatcher.emitChange("packages/example/src/plugin.ts");
  fakeWatcher.emitChange(
    "packages/example/node_modules/dependency/package.json",
  );
  await delay(15);
  assert.equal(refreshCount, 0);

  fakeWatcher.emitChange("packages/example/registry.json");
  fakeWatcher.emitChange("packages/example/manifest.json");
  await waitFor(() => refreshCount === 1);
  fakeWatcher.emitChange(
    "packages/example/registry-assets/gallery/workspace.preview.webp",
  );
  fakeWatcher.emitChange("packages/example/registry-content/overview.md");
  await delay(15);
  assert.equal(refreshCount, 1);

  firstRefresh.resolve();
  await watcher.waitForIdle();
  assert.equal(refreshCount, 2);
  assert.equal(maximumActiveRefreshes, 1);
  assert.deepEqual(refreshedPaths, [
    ["packages/example/manifest.json", "packages/example/registry.json"],
    [
      "packages/example/registry-assets/gallery/workspace.preview.webp",
      "packages/example/registry-content/overview.md",
    ],
  ]);
  assert.equal(isLocalSourcePreviewInput(null), true);
  assert.equal(
    isLocalSourcePreviewInput("packages/example/CHANGELOG.md"),
    true,
  );
  assert.equal(isLocalSourcePreviewInput("packages/example/README.md"), false);

  rejectNextRefresh = true;
  fakeWatcher.emitChange("packages/example/registry.json");
  await watcher.waitForIdle();
  assert.deepEqual(refreshErrors, ["Invalid intermediate source metadata."]);
  fakeWatcher.emitChange("packages/example/registry.json");
  await watcher.waitForIdle();
  assert.equal(refreshCount, 4);
  assert.equal(maximumActiveRefreshes, 1);

  await watcher.close();
  assert.equal(fakeWatcher.closed, true);
});

class FakeWatcher extends EventEmitter {
  closed = false;
  listener = () => {};

  close() {
    this.closed = true;
  }

  emitChange(filename) {
    this.listener("change", filename);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await delay(2);
  }
  throw new Error("Timed out waiting for local source preview refresh.");
}

async function writeSourceFixture({ sourceDir, baseRegistryDir }) {
  await mkdir(path.join(sourceDir, "registry-content"), { recursive: true });
  await mkdir(path.join(sourceDir, "registry-assets", "gallery"), {
    recursive: true,
  });
  await mkdir(path.join(baseRegistryDir, "plugins"), { recursive: true });

  const previewImage = await image(1200, 800);
  const fullImage = await image(2400, 1600);
  const logo = await image(128, 128);
  await writeJson(path.join(sourceDir, "registry.json"), registrySource());
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
  await writeFile(path.join(sourceDir, "registry-assets", "logo.webp"), logo);
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
  return { previewImage, fullImage };
}

function registrySource(
  alt = "Example Plugin displayed in the Lapis workspace.",
) {
  return {
    schemaVersion: 1,
    categories: ["productivity"],
    highlights: ["Keeps end-user registry copy separate from package docs."],
    appearance: {
      icon: "package",
      accent: "#8B5CF6",
      logo: {
        path: "registry-assets/logo.webp",
        alt: "Example Plugin logo",
      },
    },
    gallery: [
      {
        id: "workspace",
        alt,
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
  };
}

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

function image(
  width,
  height,
  background = { r: 139, g: 92, b: 246, alpha: 1 },
) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  })
    .webp({ lossless: true })
    .toBuffer();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
