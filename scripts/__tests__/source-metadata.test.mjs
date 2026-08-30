import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  assertSafeAssetPath,
  assertSafeMarkdownPath,
  fetchPluginSourceMetadata,
  maxPluginMarkdownBytes,
} from "../lib/source-metadata.mjs";

const sourceCommit = "b".repeat(40);
const payload = {
  repository: "lapismd/lapis-plugins",
  packageName: "@lapis-notes/search",
  pluginId: "lapis-search",
  version: "0.1.0",
  sourceCommit,
};

test("source metadata is validated, derived, hashed, and mirrored deterministically", async () => {
  const fixture = await fixtureDir();
  const fetchImpl = await sourceFetch();
  const first = await fetchPluginSourceMetadata({
    payload,
    fetchImpl,
    outputDir: fixture.contentDir,
    assetOutputDir: fixture.assetDir,
  });
  const second = await fetchPluginSourceMetadata({
    payload,
    fetchImpl,
    outputDir: fixture.contentDir,
    assetOutputDir: fixture.assetDir,
  });
  assert.deepEqual(first, second);
  assert.equal(first.license, "MIT");
  assert.equal(first.links.documentation, "https://lapis.md/plugins/search");
  assert.equal(first.content.overview.mediaType, "text/markdown");
  assert.deepEqual(first.appearance, {
    icon: "search",
    accent: "#F59E0B",
  });
  assert.equal(first.gallery[0].width, 1200);
  assert.equal(first.gallery[0].height, 800);
  assert.equal(first.gallery[0].mediaType, "image/png");
  assert.equal(
    await readFile(
      new URL(`lapis-search/${first.gallery[0].sha256}.png`, fixture.assetDir),
    ).then((bytes) => bytes.byteLength),
    first.gallery[0].size,
  );
  assert.equal(first.content.overview.size, Buffer.byteLength("# Search\n"));
  assert.equal(
    await readFile(
      new URL("lapis-search/overview.md", fixture.contentDir),
      "utf8",
    ),
    "# Search\n",
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("standalone repositories resolve source metadata from their root", async () => {
  const fixture = await fixtureDir();
  const urls = [];
  const standalonePayload = {
    ...payload,
    repository: "lapismd/lapis-plugin-tasks",
    packageName: "@lapis-notes/lapis-plugin-tasks",
    pluginId: "lapis-tasks",
  };
  await fetchPluginSourceMetadata({
    payload: standalonePayload,
    outputDir: fixture.contentDir,
    assetOutputDir: fixture.assetDir,
    fetchImpl: await sourceFetch({
      payload: standalonePayload,
      onFetch: (url) => urls.push(url),
    }),
  });
  assert.ok(
    urls.includes(
      `https://raw.githubusercontent.com/lapismd/lapis-plugin-tasks/${sourceCommit}/registry.json`,
    ),
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("source metadata rejects unsafe paths, insecure links, ownership mismatches, and oversized Markdown", async () => {
  assert.throws(() => assertSafeMarkdownPath("../README.md"), /Unsafe/);
  assert.throws(() => assertSafeAssetPath("../logo.svg"), /Unsafe/);
  await assert.rejects(
    fetchPluginSourceMetadata({
      payload,
      fetchImpl: await sourceFetch({
        source: { documentationUrl: "http://example.test/docs" },
      }),
    }),
    /documentationUrl|documentation URL must use HTTPS/,
  );
  await assert.rejects(
    fetchPluginSourceMetadata({
      payload,
      fetchImpl: await sourceFetch({
        packageJson: { name: "@lapis-notes/other" },
      }),
    }),
    /package\.json name does not match/,
  );
  await assert.rejects(
    fetchPluginSourceMetadata({
      payload,
      fetchImpl: await sourceFetch({
        readme: Buffer.alloc(maxPluginMarkdownBytes + 1, "a"),
      }),
    }),
    /exceeds 262144 bytes/,
  );
});

test("source metadata rejects unsafe logos and incorrect gallery dimensions", async () => {
  const unsafeSvg = Buffer.from(
    '<svg viewBox="0 0 128 128"><script>alert(1)</script></svg>',
  );
  await assert.rejects(
    fetchPluginSourceMetadata({
      payload,
      fetchImpl: await sourceFetch({
        source: {
          appearance: {
            icon: "search",
            accent: "#F59E0B",
            logo: { path: "registry-assets/logo.svg", alt: "Search logo" },
          },
        },
        logo: unsafeSvg,
      }),
    }),
    /unsafe content/,
  );

  await assert.rejects(
    fetchPluginSourceMetadata({
      payload,
      fetchImpl: await sourceFetch({
        gallery: await png(640, 480),
      }),
    }),
    /must be 1200x800/,
  );
});

async function sourceFetch(options = {}) {
  const activePayload = options.payload ?? payload;
  const packageRoot =
    activePayload.repository === "lapismd/lapis-plugins"
      ? "packages/search/"
      : "";
  const base = `https://raw.githubusercontent.com/${activePayload.repository}/${sourceCommit}/${packageRoot}`;
  const source = {
    schemaVersion: 1,
    categories: ["search", "navigation"],
    highlights: ["Search vault content quickly."],
    documentationUrl: "https://lapis.md/plugins/search",
    appearance: { icon: "search", accent: "#F59E0B" },
    gallery: [
      {
        id: "overview",
        path: "registry-assets/overview.desktop.png",
        surface: "desktop",
        alt: "Search results in Lapis Notes",
        caption: "Search indexed notes",
        capture: { storyId: "plugins-search--registry-showcase" },
      },
    ],
    content: { overview: "README.md", changelog: "CHANGELOG.md" },
    ...options.source,
  };
  const packageJson = {
    name: activePayload.packageName,
    version: "0.1.0",
    license: "MIT",
    homepage: "https://lapis.md/plugins/search",
    repository: `https://github.com/${activePayload.repository}.git`,
    bugs: { url: `https://github.com/${activePayload.repository}/issues` },
    ...options.packageJson,
  };
  const manifest = {
    id: activePayload.pluginId,
    name: "Search",
    version: "0.1.0",
    minAppVersion: "0.1.0",
    description: "Search the active vault.",
    author: "Lapis Notes",
    isDesktopOnly: false,
    ...options.manifest,
  };
  const files = new Map([
    [`${base}registry.json`, jsonBytes(source)],
    [`${base}package.json`, jsonBytes(packageJson)],
    [`${base}manifest.json`, jsonBytes(manifest)],
    [`${base}README.md`, options.readme ?? Buffer.from("# Search\n")],
    [`${base}CHANGELOG.md`, Buffer.from("# Changelog\n")],
    [
      `${base}registry-assets/overview.desktop.png`,
      options.gallery ?? (await png(1200, 800)),
    ],
  ]);
  if (source.appearance?.logo) {
    files.set(
      `${base}${source.appearance.logo.path}`,
      options.logo ?? (await png(128, 128)),
    );
  }
  return async (url) => {
    options.onFetch?.(String(url));
    const bytes = files.get(String(url));
    if (!bytes) return { ok: false, status: 404, headers: new Headers() };
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(bytes.byteLength) },
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
    };
  };
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

async function fixtureDir() {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-source-metadata-"));
  const contentDir = new URL("generated/v1/content/", `file://${root}/`);
  const assetDir = new URL("generated/v1/assets/", `file://${root}/`);
  await mkdir(contentDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  return { root, contentDir, assetDir };
}

function png(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 139, g: 92, b: 246, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}
