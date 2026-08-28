import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
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
  const fetchImpl = sourceFetch();
  const first = await fetchPluginSourceMetadata({
    payload,
    fetchImpl,
    outputDir: fixture.contentDir,
  });
  const second = await fetchPluginSourceMetadata({
    payload,
    fetchImpl,
    outputDir: fixture.contentDir,
  });
  assert.deepEqual(first, second);
  assert.equal(first.license, "MIT");
  assert.equal(first.links.documentation, "https://lapis.md/plugins/search");
  assert.equal(first.content.overview.mediaType, "text/markdown");
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
    fetchImpl: sourceFetch({
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
  await assert.rejects(
    fetchPluginSourceMetadata({
      payload,
      fetchImpl: sourceFetch({
        source: { documentationUrl: "http://example.test/docs" },
      }),
    }),
    /documentationUrl|documentation URL must use HTTPS/,
  );
  await assert.rejects(
    fetchPluginSourceMetadata({
      payload,
      fetchImpl: sourceFetch({ packageJson: { name: "@lapis-notes/other" } }),
    }),
    /package\.json name does not match/,
  );
  await assert.rejects(
    fetchPluginSourceMetadata({
      payload,
      fetchImpl: sourceFetch({
        readme: Buffer.alloc(maxPluginMarkdownBytes + 1, "a"),
      }),
    }),
    /exceeds 262144 bytes/,
  );
});

function sourceFetch(options = {}) {
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
  ]);
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
  await mkdir(contentDir, { recursive: true });
  return { root, contentDir };
}
