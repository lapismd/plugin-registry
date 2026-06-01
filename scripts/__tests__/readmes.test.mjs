import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  fetchReadmeMarkdown,
  localizeReadmeImages,
  isPrivateOrLocalHost,
  publishRegistryReadmes,
  renderMarkdownToSafeHtml,
} from "../lib/readmes.mjs";

test("publishRegistryReadmes writes deterministic markdown and HTML artifacts", async () => {
  const fixture = await fixtureDir();
  const result = await publishRegistryReadmes({
    registryDir: fixture.registryDir,
    outputDir: fixture.outputDir,
    fetchImpl: async () =>
      new Response("# Example\n\n- **Ready**", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
  });

  assert.deepEqual(result.skipped, []);
  assert.equal(
    result.published[0].markdownPath,
    "readmes/lapis-test/README.md",
  );
  assert.equal(result.published[0].htmlPath, "readmes/lapis-test/README.html");
  assert.equal(
    result.published[0].manifestPath,
    "readmes/lapis-test/manifest.json",
  );
  assert.equal(
    await readFile(
      new URL("readmes/lapis-test/README.md", fixture.outputDir),
      "utf8",
    ),
    "# Example\n\n- **Ready**",
  );
  assert.match(
    await readFile(
      new URL("readmes/lapis-test/README.html", fixture.outputDir),
      "utf8",
    ),
    /<h1>Example<\/h1>/,
  );
  const manifest = JSON.parse(
    await readFile(
      new URL("readmes/lapis-test/manifest.json", fixture.outputDir),
      "utf8",
    ),
  );
  assert.match(manifest.markdown.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.images.length, 0);

  await rm(fixture.root, { recursive: true, force: true });
});

test("localizeReadmeImages mirrors images and rewrites markdown", async () => {
  const fixture = await fixtureDir();
  const result = await localizeReadmeImages({
    markdown:
      "![Logo](./logo.png)\n\n![Remote](https://cdn.example.test/remote.webp)",
    sourceUrl: new URL("https://example.test/docs/README.md"),
    targetDir: new URL("readmes/lapis-test/", fixture.outputDir),
    fetchImpl: async (url) =>
      new Response(`image:${url}`, {
        headers: {
          "content-type": url.endsWith(".webp") ? "image/webp" : "image/png",
        },
      }),
  });

  assert.match(result.markdown, /!\[Logo\]\(assets\/[a-f0-9]{16}\.png\)/);
  assert.match(result.markdown, /!\[Remote\]\(assets\/[a-f0-9]{16}\.webp\)/);
  assert.equal(result.images.length, 2);
  assert.match(result.images[0].sha256, /^[a-f0-9]{64}$/);

  await rm(fixture.root, { recursive: true, force: true });
});

test("fetchReadmeMarkdown rejects oversized and non-text responses", async () => {
  await assert.rejects(
    fetchReadmeMarkdown(
      "https://example.test/README.md",
      async () =>
        new Response("binary", {
          headers: { "content-type": "application/octet-stream" },
        }),
    ),
    /not text/,
  );
  await assert.rejects(
    fetchReadmeMarkdown(
      "https://example.test/README.md",
      async () =>
        new Response("x", {
          headers: {
            "content-length": String(300 * 1024),
            "content-type": "text/plain",
          },
        }),
    ),
    /too large/,
  );
});

test("private and local README hosts are skipped", async () => {
  const fixture = await fixtureDir({
    readmeUrl: "https://127.0.0.1/README.md",
  });
  const result = await publishRegistryReadmes({
    registryDir: fixture.registryDir,
    outputDir: fixture.outputDir,
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
  });

  assert.deepEqual(result.published, []);
  assert.equal(result.skipped[0].reason, "invalid-readme-url");
  assert.equal(isPrivateOrLocalHost("192.168.1.4"), true);
  assert.equal(isPrivateOrLocalHost("example.test"), false);

  await rm(fixture.root, { recursive: true, force: true });
});

test("markdown renderer escapes unsafe HTML", () => {
  const html = renderMarkdownToSafeHtml(
    "# Title\n\n<img src=x onerror=alert(1)>\n\n[Docs](https://example.test)",
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<a href="https:\/\/example.test\/"/);
  assert.doesNotMatch(html, /<img src=x/);
});

async function fixtureDir({
  readmeUrl = "https://example.test/README.md",
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-readmes-"));
  const registryDir = new URL("generated/v1/", `file://${root}/`);
  const outputDir = new URL("dist/v1/", `file://${root}/`);
  await writeJson(new URL("index.json", registryDir), {
    plugins: [
      {
        id: "lapis-test",
        readmeUrl,
        detail: "plugins/lapis-test.json",
      },
    ],
  });
  await writeJson(new URL("plugins/lapis-test.json", registryDir), {
    id: "lapis-test",
    readmeUrl,
  });
  return { root, registryDir, outputDir };
}

async function writeJson(url, value) {
  await mkdir(new URL(".", url), { recursive: true });
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`);
}
