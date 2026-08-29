import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  buildRegistry,
  canonicalize,
  createAjv,
  formatAjvErrors,
  readJsonc,
  sha256,
  signJson,
  validateEntryRules,
  verifyJson,
} from "../lib/registry.mjs";

function validEntry(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "lapis-graph",
    name: "Graph",
    description: "Graph and local graph views powered by the metadata cache.",
    readmeUrl:
      "https://raw.githubusercontent.com/lapismd/lapis-plugins/main/packages/graph/README.md",
    author: "Lapis Notes",
    authorUrl: "https://app.lapis.md",
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
    __sourcePath: "entries/official/lapis-graph.jsonc",
    ...overrides,
  };
}

test("valid Graph entry passes schema and custom validation", async () => {
  const ajv = await createAjv();
  const validate = ajv.getSchema(
    "https://registry.lapis.md/schemas/catalog-entry.schema.json",
  );
  const entry = validEntry();
  const schemaEntry = { ...entry };
  delete schemaEntry.__sourcePath;

  assert.equal(validate(schemaEntry), true, formatAjvErrors(validate));
  assert.deepEqual(validateEntryRules([entry]), []);
});

test("rejects duplicate plugin ids", () => {
  const errors = validateEntryRules([
    validEntry({ __sourcePath: "a.jsonc" }),
    validEntry({ __sourcePath: "b.jsonc" }),
  ]);
  assert.match(errors.join("\n"), /duplicate plugin id lapis-graph/);
});

test("rejects invalid plugin ids", () => {
  const errors = validateEntryRules([validEntry({ id: "Lapis Docs" })]);
  assert.match(errors.join("\n"), /invalid plugin id/);
});

test("rejects non-HTTPS release URLs", () => {
  const entry = validEntry();
  entry.versions["2026.6.6"].bundle.url =
    "http://example.test/lapis-graph-2026.6.6.lapis-plugin";
  const errors = validateEntryRules([entry]);
  assert.match(errors.join("\n"), /URL must use HTTPS/);
});

test("rejects non-HTTPS readmeUrl", () => {
  const errors = validateEntryRules([
    validEntry({ readmeUrl: "http://example.test/README.md" }),
  ]);
  assert.match(errors.join("\n"), /readmeUrl must use HTTPS/);
});

test("rejects non-pending bundles without real hash and size", () => {
  const entry = validEntry();
  entry.versions["2026.6.6"].bundle.sha256 = "0".repeat(64);
  entry.versions["2026.6.6"].bundle.size = 0;
  const errors = validateEntryRules([entry]);
  assert.match(errors.join("\n"), /real sha256 and size/);
});

test("builds deterministic registry metadata with real GitHub references", () => {
  const registry = buildRegistry([validEntry()]);
  assert.equal(registry.index.plugins[0].id, "lapis-graph");
  assert.equal(registry.index.plugins[0].detail, "plugins/lapis-graph.json");
  assert.deepEqual(registry.index.plugins[0].latestRelease, {
    releasedAt: "2026-06-06T22:47:39Z",
    bundleSize: 116157,
  });
  assert.equal(
    registry.details["lapis-graph"].readmeUrl,
    "https://raw.githubusercontent.com/lapismd/lapis-plugins/main/packages/graph/README.md",
  );
  assert.deepEqual(registry.revoked.revoked, []);
  assert.equal(
    registry.details["lapis-graph"].versions["2026.6.6"].bundle.downloadUrl,
    "../../download/lapis-graph/2026.6.6",
  );
  assert.deepEqual(registry.downloadTargets.targets["lapis-graph@2026.6.6"], {
    pluginId: "lapis-graph",
    version: "2026.6.6",
    originUrl:
      "https://github.com/lapis-notes/releases/releases/download/official-plugin-assets-lapis-graph-2026.6.6/lapis-graph-2026.6.6.lapis-plugin",
    status: "active",
  });
});

test("release status overrides plugin status in the download target map", () => {
  const entry = validEntry();
  entry.versions["2026.6.6"].status = "revoked";

  const registry = buildRegistry([entry]);

  assert.equal(
    registry.downloadTargets.targets["lapis-graph@2026.6.6"].status,
    "revoked",
  );
});

test("canonicalization sorts object keys", () => {
  assert.equal(
    canonicalize({ b: 1, a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"b":1}',
  );
});

test("hashing returns sha256 hex", () => {
  assert.equal(
    sha256(Buffer.from("lapis")),
    "03e4f7cf9317923e0a8cb2fa6914923c035fd9d8f447dea162e7ffc50904585e",
  );
});

test("signatures verify and tampering is rejected", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const value = { schemaVersion: 1, plugins: ["lapis-docs"] };
  const { sidecar, publicKey } = signJson(value, privateKeyPem, "test-key");

  assert.equal(verifyJson(value, sidecar, publicKey), true);
  assert.equal(
    verifyJson({ ...value, plugins: [] }, sidecar, publicKey),
    false,
  );
});

test("JSONC source files parse with comments", async () => {
  const value = await readJsonc(
    new URL("./fixtures/commented.jsonc", import.meta.url),
  );
  assert.deepEqual(value, { schemaVersion: 1, id: "lapis-docs" });
});
