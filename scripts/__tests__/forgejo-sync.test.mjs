import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverForgejoReleaseAssets,
  officialForgejoPluginIds,
  parseArgs,
  selectLatestPluginReleaseAssets,
  syncForgejoReleases,
} from "../sync-forgejo-releases.mjs";
import {
  canonicalize,
  sha256,
  signJson,
  verifyJson,
} from "../lib/registry.mjs";
import {
  generateRegistryKey,
  publicKeyPemToRawBase64,
  resolveRegistrySigningKey,
} from "../lib/keys.mjs";

test("default official Forgejo plugin list excludes bases and includes markdown lint", () => {
  assert.equal(officialForgejoPluginIds.includes("lapis-bases"), false);
  assert.equal(officialForgejoPluginIds.includes("lapis-markdown-lint"), true);
});

test("parseArgs accepts explicit plugin selections", () => {
  assert.deepEqual(
    parseArgs([
      "--plugins",
      "lapis-pdf,lapis-graph",
      "--release-tag",
      "official-plugin-assets-1",
      "--dry-run",
    ]),
    {
      plugins: ["lapis-pdf", "lapis-graph"],
      pluginsExplicit: true,
      releaseTag: "official-plugin-assets-1",
      dryRun: true,
      forgejoServer: "https://code.ju.ma",
      forgejoRepo: "lapis-notes/lapis",
      help: false,
    },
  );
});

test("selectLatestPluginReleaseAssets picks latest semver-compatible CalVer", () => {
  const selected = selectLatestPluginReleaseAssets(
    [
      asset("lapis-pdf-2026.6.1-release.signed.json"),
      asset("lapis-pdf-2026.6.1-patch.1-release.signed.json"),
      asset("lapis-pdf-2026.6.2-release.signed.json"),
    ],
    ["lapis-pdf"],
  );
  assert.equal(selected.get("lapis-pdf").version, "2026.6.2");
});

test("discoverForgejoReleaseAssets reads assets from a specific release tag", async () => {
  const fetchImpl = async (url) =>
    jsonResponse({
      tag_name: "official-plugin-assets-1",
      assets: [
        {
          name: "lapis-pdf-2026.6.1-release.signed.json",
          size: 100,
          browser_download_url: `${url}/download`,
        },
      ],
    });
  const assets = await discoverForgejoReleaseAssets({
    fetchImpl,
    forgejoServer: "https://code.ju.ma",
    forgejoRepo: "lapis-notes/lapis",
    releaseTag: "official-plugin-assets-1",
  });
  assert.equal(assets[0].releaseTag, "official-plugin-assets-1");
  assert.equal(assets[0].name, "lapis-pdf-2026.6.1-release.signed.json");
});

test("default sync skips missing releases without writing entries", async () => {
  const fixture = await fixtureDir();
  const result = await syncForgejoReleases({
    plugins: ["lapis-pdf"],
    entriesDir: fixture.entriesDir,
    trustRootPath: fixture.trustRootPath,
    fetchImpl: async () => jsonResponse([]),
    dryRun: false,
  });
  assert.deepEqual(result.updates, []);
  assert.deepEqual(result.skipped, [
    { pluginId: "lapis-pdf", reason: "missing-release" },
  ]);
  await assert.rejects(
    readFile(new URL("lapis-pdf.jsonc", fixture.entriesDir), "utf8"),
    /ENOENT/,
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("explicit sync rejects missing releases", async () => {
  const fixture = await fixtureDir();
  await assert.rejects(
    syncForgejoReleases({
      plugins: ["lapis-pdf"],
      pluginsExplicit: true,
      entriesDir: fixture.entriesDir,
      trustRootPath: fixture.trustRootPath,
      fetchImpl: async () => jsonResponse([]),
    }),
    /No Forgejo release asset found for lapis-pdf/,
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("sync writes active markdown lint entry with release hashes and files", async () => {
  const fixture = await fixtureDir();
  const releaseFixture = signedReleaseFixture({
    pluginId: "lapis-markdown-lint",
    version: "2026.6.1",
  });
  await writeTrustRoot(fixture.trustRootPath, releaseFixture.publicKeyPem);
  const result = await syncForgejoReleases({
    plugins: ["lapis-markdown-lint"],
    pluginsExplicit: true,
    entriesDir: fixture.entriesDir,
    trustRootPath: fixture.trustRootPath,
    releaseTag: "official-plugin-assets-1",
    fetchImpl: releaseFixture.fetchImpl,
  });
  const entry = JSON.parse(
    await readFile(new URL("lapis-markdown-lint.jsonc", fixture.entriesDir)),
  );

  assert.equal(result.updates[0].pluginId, "lapis-markdown-lint");
  assert.equal(entry.status, "active");
  assert.equal(entry.latestVersion, "2026.6.1");
  assert.equal(
    entry.versions["2026.6.1"].releaseManifest.sha256,
    sha256(releaseFixture.envelopeBytes),
  );
  assert.equal(entry.versions["2026.6.1"].releaseManifest.pending, undefined);
  assert.deepEqual(
    entry.versions["2026.6.1"].files.map((file) => file.path),
    ["manifest.json", "main.js"],
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("sync preserves curated readmeUrl values", async () => {
  const fixture = await fixtureDir();
  const releaseFixture = signedReleaseFixture({
    pluginId: "lapis-pdf",
    version: "2026.6.1",
  });
  await writeTrustRoot(fixture.trustRootPath, releaseFixture.publicKeyPem);
  await writeFile(
    new URL("lapis-pdf.jsonc", fixture.entriesDir),
    JSON.stringify({
      schemaVersion: 1,
      id: "lapis-pdf",
      name: "PDF",
      description: "PDF viewing for Lapis.",
      readmeUrl:
        "https://code.ju.ma/lapis-notes/lapis/raw/branch/main/packages/plugins/plugin-pdf/README.md",
      author: "Lapis Notes",
      channel: "official",
      status: "pending",
      latestVersion: "0.1.0",
      minAppVersion: "1.7.7",
      platforms: ["web", "electron"],
      categories: ["viewer", "documents"],
      badges: ["official", "verified"],
      owner: { name: "Lapis Notes", verified: true },
      versions: {
        "0.1.0": {
          version: "0.1.0",
          minAppVersion: "1.7.7",
          releasedAt: "2026-05-31T00:00:00.000Z",
          platforms: ["web", "electron"],
          releaseManifest: {
            url: "https://example.test/pending.json",
            sha256: "0".repeat(64),
            size: 0,
            pending: true,
          },
          files: [],
        },
      },
    }),
  );
  await syncForgejoReleases({
    plugins: ["lapis-pdf"],
    pluginsExplicit: true,
    entriesDir: fixture.entriesDir,
    trustRootPath: fixture.trustRootPath,
    releaseTag: "official-plugin-assets-1",
    fetchImpl: releaseFixture.fetchImpl,
  });
  const entry = JSON.parse(
    await readFile(new URL("lapis-pdf.jsonc", fixture.entriesDir)),
  );
  assert.equal(
    entry.readmeUrl,
    "https://code.ju.ma/lapis-notes/lapis/raw/branch/main/packages/plugins/plugin-pdf/README.md",
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("sync can trust a local plugin release public key and records it in root", async () => {
  const fixture = await fixtureDir();
  const releaseFixture = signedReleaseFixture({
    pluginId: "lapis-pdf",
    version: "2026.6.1",
  });
  await writeTrustRoot(fixture.trustRootPath, "");
  await syncForgejoReleases({
    plugins: ["lapis-pdf"],
    pluginsExplicit: true,
    entriesDir: fixture.entriesDir,
    trustRootPath: fixture.trustRootPath,
    releaseTag: "official-plugin-assets-1",
    fetchImpl: releaseFixture.fetchImpl,
    env: {
      LAPIS_PLUGIN_RELEASE_KEY_ID: "lapis-plugin-release-test",
      LAPIS_PLUGIN_RELEASE_PUBLIC_KEY_PEM: releaseFixture.publicKeyPem,
    },
  });
  const root = JSON.parse(await readFile(fixture.trustRootPath, "utf8"));
  assert.equal(root.roles.release.includes("lapis-plugin-release-test"), true);
  assert.equal(
    root.keys.some((key) => key.keyId === "lapis-plugin-release-test"),
    true,
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("registry signing key resolves from ~/.lapis fallback", async () => {
  const fixture = await fixtureDir();
  await generateRegistryKey({
    dir: fixture.lapisDir,
    keyId: "lapis-registry-test",
  });
  const key = await resolveRegistrySigningKey({}, fixture.root);
  assert.equal(key.keyId, "lapis-registry-test");
  const signed = signJson({ schemaVersion: 1 }, key.privateKeyPem, key.keyId);
  assert.equal(
    verifyJson({ schemaVersion: 1 }, signed.sidecar, signed.publicKey),
    true,
  );
  await rm(fixture.root, { recursive: true, force: true });
});

test("registry signing key resolves base64 PEM env secret", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const key = await resolveRegistrySigningKey({
    LAPIS_REGISTRY_KEY_ID: "lapis-registry-test",
    LAPIS_REGISTRY_PRIVATE_KEY_PEM_B64:
      Buffer.from(privateKeyPem).toString("base64"),
  });
  const signed = signJson({ schemaVersion: 1 }, key.privateKeyPem, key.keyId);
  assert.equal(
    verifyJson({ schemaVersion: 1 }, signed.sidecar, signed.publicKey),
    true,
  );
});

test("registry signing key normalizes escaped newline PEM env secret", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const key = await resolveRegistrySigningKey({
    LAPIS_REGISTRY_KEY_ID: "lapis-registry-test",
    LAPIS_REGISTRY_PRIVATE_KEY_PEM: privateKeyPem.replaceAll("\n", "\\n"),
  });
  const signed = signJson({ schemaVersion: 1 }, key.privateKeyPem, key.keyId);
  assert.equal(
    verifyJson({ schemaVersion: 1 }, signed.sidecar, signed.publicKey),
    true,
  );
});

function asset(name) {
  return { name, releaseTag: "tag", url: `https://example.test/${name}` };
}

function signedReleaseFixture({ pluginId, version }) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const manifestBytes = Buffer.from(
    JSON.stringify({ id: pluginId, version, name: pluginId }),
  );
  const mainBytes = Buffer.from("export default class Plugin {}\n");
  const signed = {
    schemaVersion: 1,
    type: "lapis.plugin.release",
    pluginId,
    version,
    channel: "official",
    compatibility: {
      minAppVersion: "1.7.7",
      platforms: ["web", "electron"],
    },
    files: [
      {
        path: "manifest.json",
        url: "https://code.ju.ma/lapis-notes/lapis/releases/download/official-plugin-assets-1/manifest-asset",
        sha256: sha256(manifestBytes),
        size: manifestBytes.byteLength,
      },
      {
        path: "main.js",
        url: "https://code.ju.ma/lapis-notes/lapis/releases/download/official-plugin-assets-1/main-asset",
        sha256: sha256(mainBytes),
        size: mainBytes.byteLength,
      },
    ],
  };
  const signature = signJson(
    signed,
    privateKeyPem,
    "lapis-plugin-release-test",
  );
  const envelope = {
    signed,
    signatures: [signature.sidecar],
  };
  const envelopeBytes = Buffer.from(canonicalize(envelope));
  const releaseUrl = `https://code.ju.ma/lapis-notes/lapis/releases/download/official-plugin-assets-1/${pluginId}-${version}-release.signed.json`;
  const fetchImpl = async (url) => {
    if (String(url).includes("/api/v1/")) {
      return jsonResponse({
        tag_name: "official-plugin-assets-1",
        assets: [
          {
            name: `${pluginId}-${version}-release.signed.json`,
            size: envelopeBytes.byteLength,
            browser_download_url: releaseUrl,
          },
        ],
      });
    }
    if (url === releaseUrl) return byteResponse(envelopeBytes);
    if (url.endsWith("manifest-asset")) return byteResponse(manifestBytes);
    if (url.endsWith("main-asset")) return byteResponse(mainBytes);
    return { ok: false, status: 404 };
  };
  return { publicKeyPem, envelopeBytes, fetchImpl };
}

async function fixtureDir() {
  const root = await mkdtemp(path.join(tmpdir(), "lapis-registry-sync-"));
  const entriesDir = new URL("entries/official/", `file://${root}/`);
  const trustRootPath = new URL(
    "generated/v1/trust/root.json",
    `file://${root}/`,
  );
  const lapisDir = path.join(root, ".lapis");
  await mkdir(entriesDir, { recursive: true });
  await mkdir(new URL("./", trustRootPath), { recursive: true });
  return { root, entriesDir, trustRootPath, lapisDir };
}

async function writeTrustRoot(trustRootPath, publicKeyPem) {
  const keys = publicKeyPem
    ? [
        {
          keyId: "lapis-plugin-release-test",
          alg: "ed25519",
          publicKeyPem,
          publicKey: publicKeyPemToRawBase64(publicKeyPem),
        },
      ]
    : [];
  await writeFile(
    trustRootPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: "2026-05-31T00:00:00.000Z",
        keys,
        roles: {
          registry: [],
          release: publicKeyPem ? ["lapis-plugin-release-test"] : [],
        },
      },
      null,
      2,
    )}\n`,
  );
}

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  };
}

function byteResponse(bytes) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}
