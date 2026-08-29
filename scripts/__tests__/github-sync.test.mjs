import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

import {
  parseDispatchEvent,
  parseMetadataDispatchEvent,
  syncGitHubRelease,
  syncGitHubMetadata,
  validateDispatchPayload,
  validateMetadataDispatchPayload,
} from "../sync-github-release.mjs";
import { canonicalize, sha256, signJson } from "../lib/registry.mjs";
import { publicKeyPemToRawBase64 } from "../lib/keys.mjs";

const sourceCommit = "a".repeat(40);
const payload = {
  repository: "lapismd/lapis-plugins",
  package_name: "@lapis-notes/graph",
  plugin_id: "lapis-graph",
  version: "0.1.2",
  release_tag: "graph@0.1.2",
  asset_name: "lapis-graph-0.1.2.lapis-plugin",
  source_commit: sourceCommit,
};

test("repository_dispatch validation accepts the complete release payload", () => {
  assert.deepEqual(
    parseDispatchEvent({ action: "plugin_release", client_payload: payload }),
    {
      repository: "lapismd/lapis-plugins",
      packageName: "@lapis-notes/graph",
      pluginId: "lapis-graph",
      version: "0.1.2",
      releaseTag: "graph@0.1.2",
      assetName: "lapis-graph-0.1.2.lapis-plugin",
      sourceCommit,
    },
  );
});

test("repository_dispatch validation rejects missing, extra, and mismatched coordinates", () => {
  assert.throws(
    () => validateDispatchPayload({ ...payload, unexpected: "field" }),
    /Unknown GitHub dispatch fields/,
  );
  assert.throws(
    () => validateDispatchPayload({ ...payload, package_name: "graph" }),
    /scoped npm package/,
  );
  assert.throws(
    () => validateDispatchPayload({ ...payload, asset_name: "graph.zip" }),
    /asset_name must be lapis-graph-0.1.2.lapis-plugin/,
  );
  assert.throws(
    () => parseDispatchEvent({ action: "other", client_payload: payload }),
    /Expected repository_dispatch action plugin_release/,
  );
});

test("metadata dispatch accepts source coordinates without release fields", () => {
  const metadataPayload = {
    repository: payload.repository,
    package_name: payload.package_name,
    plugin_id: payload.plugin_id,
    source_commit: sourceCommit,
  };
  assert.deepEqual(
    parseMetadataDispatchEvent({
      action: "plugin_metadata",
      client_payload: metadataPayload,
    }),
    {
      repository: payload.repository,
      packageName: payload.package_name,
      pluginId: payload.plugin_id,
      sourceCommit,
    },
  );
  assert.throws(
    () =>
      validateMetadataDispatchPayload({
        ...metadataPayload,
        version: payload.version,
      }),
    /Unknown GitHub dispatch fields/,
  );
});

test("GitHub sync verifies release assets and updates one curated entry idempotently", async () => {
  const fixture = await fixtureDir();
  const release = signedReleaseFixture();
  await writeTrustRoot(fixture.trustRootPath, release.publicKeyPem);
  await writeFile(
    new URL("lapis-graph.jsonc", fixture.entriesDir),
    `${JSON.stringify(existingGraphEntry(), null, 2)}\n`,
  );

  const first = await syncGitHubRelease({
    payload: validateDispatchPayload(payload),
    entriesDir: fixture.entriesDir,
    trustRootPath: fixture.trustRootPath,
    contentDir: fixture.contentDir,
    fetchImpl: release.fetchImpl,
  });
  const entry = JSON.parse(
    await readFile(new URL("lapis-graph.jsonc", fixture.entriesDir), "utf8"),
  );
  assert.equal(first.changed, true);
  assert.equal(first.bundleSha256, sha256(release.bundleBytes));
  assert.equal(first.signedFiles, 3);
  assert.deepEqual(entry.source, {
    repository: payload.repository,
    packageName: payload.package_name,
    releaseTag: payload.release_tag,
    sourceCommit,
    metadataPath: "packages/graph/registry.json",
  });
  assert.equal(entry.latestVersion, "0.1.2");
  assert.equal(entry.versions["2026.6.6"].version, "2026.6.6");
  assert.equal(
    entry.versions["0.1.2"].bundle.sha256,
    sha256(release.bundleBytes),
  );
  assert.equal(
    entry.readmeUrl,
    `https://raw.githubusercontent.com/lapismd/lapis-plugins/${sourceCommit}/packages/graph/README.md`,
  );
  assert.deepEqual(entry.highlights, [
    "Explore note and tag relationships.",
    "Open graph nodes directly in the workspace.",
  ]);
  assert.equal(entry.content.overview.mediaType, "text/markdown");
  assert.equal(
    entry.links.repository,
    "https://github.com/lapismd/lapis-plugins",
  );
  assert.equal(
    await readFile(
      new URL("lapis-graph/overview.md", fixture.contentDir),
      "utf8",
    ),
    "# Graph\n\nExplore connected notes.\n",
  );

  const second = await syncGitHubRelease({
    payload: validateDispatchPayload(payload),
    entriesDir: fixture.entriesDir,
    trustRootPath: fixture.trustRootPath,
    contentDir: fixture.contentDir,
    fetchImpl: release.fetchImpl,
  });
  assert.equal(second.changed, false);
  await rm(fixture.root, { recursive: true, force: true });
});

test("GitHub sync rejects a checksum asset that does not match the bundle", async () => {
  const fixture = await fixtureDir();
  const release = signedReleaseFixture({ checksum: "f".repeat(64) });
  await writeTrustRoot(fixture.trustRootPath, release.publicKeyPem);
  await assert.rejects(
    syncGitHubRelease({
      payload: validateDispatchPayload(payload),
      entriesDir: fixture.entriesDir,
      trustRootPath: fixture.trustRootPath,
      contentDir: fixture.contentDir,
      fetchImpl: release.fetchImpl,
    }),
    /GitHub checksum does not match/,
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("GitHub sync rejects signed package and commit coordinates that differ from dispatch", async () => {
  const fixture = await fixtureDir();
  const release = signedReleaseFixture({
    packageName: "@lapis-notes/not-graph",
  });
  await writeTrustRoot(fixture.trustRootPath, release.publicKeyPem);
  await assert.rejects(
    syncGitHubRelease({
      payload: validateDispatchPayload(payload),
      entriesDir: fixture.entriesDir,
      trustRootPath: fixture.trustRootPath,
      contentDir: fixture.contentDir,
      fetchImpl: release.fetchImpl,
    }),
    /signed source coordinates do not match dispatch/,
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("GitHub sync rejects unsigned extra archive files", async () => {
  const fixture = await fixtureDir();
  const release = signedReleaseFixture({
    extraBundleFile: {
      path: "unexpected.js",
      data: Buffer.from("export const unexpected = true;\n"),
    },
  });
  await writeTrustRoot(fixture.trustRootPath, release.publicKeyPem);
  await assert.rejects(
    syncGitHubRelease({
      payload: validateDispatchPayload(payload),
      entriesDir: fixture.entriesDir,
      trustRootPath: fixture.trustRootPath,
      contentDir: fixture.contentDir,
      fetchImpl: release.fetchImpl,
    }),
    /bundle includes unsigned files: unexpected\.js/,
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("GitHub sync rejects unsafe signed paths", async () => {
  const fixture = await fixtureDir();
  const release = signedReleaseFixture({ unsafeSignedPath: "../escape.js" });
  await writeTrustRoot(fixture.trustRootPath, release.publicKeyPem);
  await assert.rejects(
    syncGitHubRelease({
      payload: validateDispatchPayload(payload),
      entriesDir: fixture.entriesDir,
      trustRootPath: fixture.trustRootPath,
      contentDir: fixture.contentDir,
      fetchImpl: release.fetchImpl,
    }),
    /unsafe|relative|path/i,
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("metadata-only sync updates content without changing release versions", async () => {
  const fixture = await fixtureDir();
  const release = signedReleaseFixture();
  await writeFile(
    new URL("lapis-graph.jsonc", fixture.entriesDir),
    `${JSON.stringify(existingGraphEntry(), null, 2)}\n`,
  );
  const metadataPayload = validateMetadataDispatchPayload({
    repository: payload.repository,
    package_name: payload.package_name,
    plugin_id: payload.plugin_id,
    source_commit: sourceCommit,
  });
  const first = await syncGitHubMetadata({
    payload: metadataPayload,
    entriesDir: fixture.entriesDir,
    contentDir: fixture.contentDir,
    fetchImpl: release.fetchImpl,
  });
  assert.equal(first.changed, true);
  assert.equal(first.entry.latestVersion, "2026.6.6");
  assert.deepEqual(Object.keys(first.entry.versions), ["2026.6.6"]);
  const second = await syncGitHubMetadata({
    payload: metadataPayload,
    entriesDir: fixture.entriesDir,
    contentDir: fixture.contentDir,
    fetchImpl: release.fetchImpl,
  });
  assert.equal(second.changed, false);
  await rm(fixture.root, { recursive: true, force: true });
});

function signedReleaseFixture(options = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const manifestBytes = Buffer.from(
    `${JSON.stringify(
      {
        id: payload.plugin_id,
        name: "Graph",
        version: payload.version,
        minAppVersion: "0.1.0",
        description: "Explore graph relationships.",
        author: "Lapis Notes",
        authorUrl: "https://app.lapis.md",
        isDesktopOnly: false,
        lapis: {
          manifestVersion: 1,
          runtime: {
            entries: {
              workspace: {
                path: "main.mjs",
                format: "esm",
                sharedDependencies: ["@lapis-notes/api"],
                requiresReloadOnUpdate: false,
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const mainBytes = Buffer.from("export default class GraphPlugin {}\n");
  const styleBytes = Buffer.from(".graph { display: block; }\n");
  const signed = {
    schemaVersion: 1,
    type: "lapis.plugin.release",
    pluginId: payload.plugin_id,
    version: payload.version,
    channel: "official",
    source: {
      package: options.packageName ?? payload.package_name,
      commit: options.sourceCommit ?? sourceCommit,
    },
    compatibility: {
      minAppVersion: "0.1.0",
      platforms: ["web", "electron"],
    },
    runtime: {
      entries: {
        workspace: {
          path: "main.mjs",
          format: "esm",
          sharedDependencies: ["@lapis-notes/api"],
          requiresReloadOnUpdate: false,
        },
      },
    },
    files: [
      signedFile("main.mjs", mainBytes),
      signedFile("manifest.json", manifestBytes),
      signedFile("styles.css", styleBytes),
      ...(options.unsafeSignedPath
        ? [signedFile(options.unsafeSignedPath, Buffer.from("unsafe\n"))]
        : []),
    ],
  };
  const signature = signJson(
    signed,
    privateKeyPem,
    "lapis-plugin-release-test",
  );
  const envelopeBytes = Buffer.from(
    canonicalize({ signed, signatures: [signature.sidecar] }),
  );
  const bundleBytes = buildPluginBundle([
    { path: "release.signed.json", data: envelopeBytes },
    { path: "main.mjs", data: mainBytes },
    { path: "manifest.json", data: manifestBytes },
    { path: "styles.css", data: styleBytes },
    ...(options.extraBundleFile ? [options.extraBundleFile] : []),
  ]);
  const checksum = options.checksum ?? sha256(bundleBytes);
  const bundleUrl =
    "https://github.com/lapismd/lapis-plugins/releases/download/graph%400.1.2/lapis-graph-0.1.2.lapis-plugin";
  const checksumUrl = `${bundleUrl}.sha256`;
  const rawBase = `https://raw.githubusercontent.com/lapismd/lapis-plugins/${sourceCommit}/packages/graph/`;
  const packageBytes = Buffer.from(
    `${JSON.stringify({
      name: payload.package_name,
      version: payload.version,
      license: "MIT",
      homepage: "https://lapis.md/plugins/graph",
      repository: {
        type: "git",
        url: "git+https://github.com/lapismd/lapis-plugins.git",
      },
      bugs: { url: "https://github.com/lapismd/lapis-plugins/issues" },
    })}\n`,
  );
  const sourceBytes = Buffer.from(
    `${JSON.stringify({
      schemaVersion: 1,
      categories: ["graph", "visualization"],
      highlights: [
        "Explore note and tag relationships.",
        "Open graph nodes directly in the workspace.",
      ],
      documentationUrl: "https://lapis.md/plugins/graph/docs",
      content: { overview: "README.md", changelog: "CHANGELOG.md" },
    })}\n`,
  );
  const readmeBytes = Buffer.from("# Graph\n\nExplore connected notes.\n");
  const changelogBytes = Buffer.from(
    "# Changelog\n\n## 0.1.0\n\nInitial release.\n",
  );
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://api.github.com/")) {
      return jsonResponse({
        tag_name: payload.release_tag,
        published_at: "2026-08-28T12:00:00Z",
        assets: [
          {
            name: payload.asset_name,
            size: bundleBytes.byteLength,
            browser_download_url: bundleUrl,
          },
          {
            name: `${payload.asset_name}.sha256`,
            size: 100,
            browser_download_url: checksumUrl,
          },
        ],
      });
    }
    if (url === bundleUrl) return byteResponse(bundleBytes);
    if (url === checksumUrl) {
      return byteResponse(Buffer.from(`${checksum}  ${payload.asset_name}\n`));
    }
    if (url === `${rawBase}registry.json`) return byteResponse(sourceBytes);
    if (url === `${rawBase}package.json`) return byteResponse(packageBytes);
    if (url === `${rawBase}manifest.json`) return byteResponse(manifestBytes);
    if (url === `${rawBase}README.md`) return byteResponse(readmeBytes);
    if (url === `${rawBase}CHANGELOG.md`) return byteResponse(changelogBytes);
    return { ok: false, status: 404 };
  };
  return { publicKeyPem, bundleBytes, fetchImpl };
}

function signedFile(filePath, bytes) {
  return { path: filePath, sha256: sha256(bytes), size: bytes.byteLength };
}

function buildPluginBundle(entries) {
  const chunks = [];
  let zipError = null;
  const zip = new Zip((error, chunk) => {
    if (error) zipError = error;
    else chunks.push(Buffer.from(chunk));
  });
  const mtime = new Date(1980, 0, 1, 0, 0, 0);
  const release = entries.find((entry) => entry.path === "release.signed.json");
  const releaseStream = new ZipPassThrough(release.path);
  releaseStream.mtime = mtime;
  zip.add(releaseStream);
  releaseStream.push(release.data, true);
  for (const entry of entries
    .filter((candidate) => candidate !== release)
    .sort((left, right) => left.path.localeCompare(right.path))) {
    const stream = new ZipDeflate(entry.path, { level: 6 });
    stream.mtime = mtime;
    zip.add(stream);
    stream.push(entry.data, true);
  }
  zip.end();
  if (zipError) throw zipError;
  return Buffer.concat(chunks);
}

function existingGraphEntry() {
  return {
    schemaVersion: 1,
    id: "lapis-graph",
    name: "Graph",
    description: "Graph and local graph views powered by the metadata cache.",
    author: "Lapis Notes",
    channel: "official",
    status: "active",
    latestVersion: "2026.6.6",
    minAppVersion: "1.7.7",
    platforms: ["web", "electron"],
    categories: ["graph", "visualization"],
    badges: ["official", "verified"],
    owner: { name: "Lapis Notes", verified: true },
    versions: {
      "2026.6.6": {
        version: "2026.6.6",
        minAppVersion: "1.7.7",
        releasedAt: "2026-06-06T22:47:39Z",
        platforms: ["web", "electron"],
        bundle: {
          url: "https://github.com/lapis-notes/releases/releases/download/official-plugin-assets-lapis-graph-2026.6.6/lapis-graph-2026.6.6.lapis-plugin",
          sha256:
            "5bc56ce3ebcf76d17888d793e031a5dd6e7d519ffbce221b339fa6df3967b66f",
          size: 116157,
        },
      },
    },
  };
}

async function fixtureDir() {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-github-sync-"));
  const entriesDir = new URL("entries/official/", `file://${root}/`);
  const trustRootPath = new URL(
    "generated/v1/trust/root.json",
    `file://${root}/`,
  );
  const contentDir = new URL("generated/v1/content/", `file://${root}/`);
  await mkdir(entriesDir, { recursive: true });
  await mkdir(new URL("./", trustRootPath), { recursive: true });
  await mkdir(contentDir, { recursive: true });
  return { root, entriesDir, trustRootPath, contentDir };
}

async function writeTrustRoot(trustRootPath, publicKeyPem) {
  await writeFile(
    trustRootPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: "2026-08-28T00:00:00.000Z",
        keys: [
          {
            keyId: "lapis-plugin-release-test",
            alg: "ed25519",
            publicKeyPem,
            publicKey: publicKeyPemToRawBase64(publicKeyPem),
          },
        ],
        roles: {
          registry: [],
          release: ["lapis-plugin-release-test"],
        },
      },
      null,
      2,
    )}\n`,
  );
}

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => value };
}

function byteResponse(bytes) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(bytes.byteLength) },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}
