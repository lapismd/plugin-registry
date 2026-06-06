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
    id: "lapis-docs",
    name: "Docs",
    description: "Rich document and spreadsheet editing for Lapis.",
    readmeUrl:
      "https://code.ju.ma/lapis-notes/lapis/raw/branch/main/packages/plugins/plugin-docs/README.md",
    author: "Lapis Notes",
    authorUrl: "https://app.lapis.md",
    channel: "official",
    status: "pending",
    latestVersion: "0.1.0",
    minAppVersion: "1.7.7",
    platforms: ["web", "electron"],
    categories: ["editor", "documents"],
    badges: ["official", "verified"],
    owner: { name: "Lapis Notes", verified: true },
    contributes: {
      editorViews: [
        {
          id: "lapis-docs.document",
          label: "Lapis Document",
          filenamePatterns: ["*.lapisdoc", "*.lapissheet"],
        },
      ],
    },
    versions: {
      "0.1.0": {
        version: "0.1.0",
        minAppVersion: "1.7.7",
        releasedAt: "2026-05-31T00:00:00.000Z",
        platforms: ["web", "electron"],
        bundle: {
          url: "https://registry.lapis.md/assets/lapis-docs/0.1.0/lapis-docs-0.1.0.lapis-plugin",
          sha256: "0".repeat(64),
          size: 0,
          pending: true,
        },
      },
    },
    __sourcePath: "entries/official/lapis-docs.jsonc",
    ...overrides,
  };
}

test("valid Docs entry passes schema and custom validation", async () => {
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
  assert.match(errors.join("\n"), /duplicate plugin id lapis-docs/);
});

test("rejects invalid plugin ids", () => {
  const errors = validateEntryRules([validEntry({ id: "Lapis Docs" })]);
  assert.match(errors.join("\n"), /invalid plugin id/);
});

test("rejects non-HTTPS release URLs", () => {
  const entry = validEntry();
  entry.versions["0.1.0"].bundle.url =
    "http://example.test/lapis-docs-0.1.0.lapis-plugin";
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
  delete entry.versions["0.1.0"].bundle.pending;
  const errors = validateEntryRules([entry]);
  assert.match(errors.join("\n"), /real sha256 and size/);
});

test("builds deterministic registry metadata with Docs contribution summary", () => {
  const registry = buildRegistry([validEntry()]);
  assert.equal(registry.index.plugins[0].id, "lapis-docs");
  assert.equal(registry.index.plugins[0].detail, "plugins/lapis-docs.json");
  assert.equal(
    registry.details["lapis-docs"].readmeUrl,
    "https://code.ju.ma/lapis-notes/lapis/raw/branch/main/packages/plugins/plugin-docs/README.md",
  );
  assert.deepEqual(
    registry.index.plugins[0].contributes.editorViews[0].filenamePatterns,
    ["*.lapisdoc", "*.lapissheet"],
  );
  assert.deepEqual(registry.revoked.revoked, []);
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
