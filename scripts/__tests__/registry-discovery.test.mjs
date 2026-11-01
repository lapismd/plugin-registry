import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import {
  discoverTargets,
  requestFromPublishedRelease,
} from "../lib/registry-discovery.mjs";
import { GitHubClient } from "../lib/github-client.mjs";
import { canonicalize, signJson } from "../lib/registry.mjs";
import {
  validateRequest,
  renderDescription,
  requestFile,
} from "../lib/registry-request.mjs";

const sha = "a".repeat(40);
function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const runtime = { workspace: { path: "main.mjs", format: "esm" } };
  const contents = {
    "main.mjs": "export default {}",
    "manifest.json": JSON.stringify({
      id: "history",
      version: "0.2.0",
      lapis: { runtime: { entries: runtime } },
    }),
    "styles.css": "",
  };
  const files = Object.entries(contents)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => ({
      path,
      sha256: createHash("sha256").update(content).digest("hex"),
      size: Buffer.byteLength(content),
    }));
  const signed = {
    type: "lapis.plugin.release",
    schemaVersion: 1,
    channel: "official",
    pluginId: "history",
    version: "0.2.0",
    source: { package: "@lapis-notes/history", commit: sha },
    compatibility: { minAppVersion: "0.1.0", platforms: ["web"] },
    runtime: { entries: runtime },
    files,
  };
  const envelope = {
    signed,
    signatures: [signJson(signed, privateKey, "release-test").sidecar],
  };
  const archive = zipSync({
    "release.signed.json": [strToU8(canonicalize(envelope)), { level: 0 }],
    ...Object.fromEntries(
      files.map((f) => [f.path, strToU8(contents[f.path])]),
    ),
  });
  const checksum = `${createHash("sha256").update(archive).digest("hex")}  history-0.2.0.lapis-plugin\n`;
  const release = {
    tag_name: "history@0.2.0",
    assets: [
      {
        name: "history-0.2.0.lapis-plugin",
        size: archive.length,
        browser_download_url: "https://github.com/archive",
      },
      {
        name: "history-0.2.0.lapis-plugin.sha256",
        size: Buffer.byteLength(checksum),
        browser_download_url: "https://github.com/checksum",
      },
    ],
  };
  const trustRoot = {
    keys: [{ keyId: "release-test", publicKeyPem: publicKey }],
    roles: { release: ["release-test"] },
  };
  const client = {
    call: async (url) =>
      url.includes("git/trees")
        ? {
            tree: ["history", "sync"].map((dir) => ({
              path: `packages/${dir}/package.json`,
            })),
          }
        : { sha },
    list: async (url) =>
      url.endsWith("/releases")
        ? [
            release,
            { ...release, prerelease: true, tag_name: "history@99.0.0" },
          ]
        : [],
    file: async (repo, file) =>
      repo.endsWith("plugin-registry")
        ? null
        : file.includes("sync/")
          ? { private: true }
          : file.endsWith("package.json")
            ? { name: "@lapis-notes/history" }
            : { id: "history" },
    tagCommit: async () => sha,
    fetch: async (url) =>
      new Response(url.endsWith("checksum") ? checksum : archive),
  };
  return { client, release, trustRoot };
}

test("recovery verifies published bytes and recovers missing latest stable plugins without executing source", async () => {
  const { client, trustRoot } = fixture();
  const result = await discoverTargets(
    client,
    { recoverMissing: true, dryRun: true },
    { trustRoot },
  );
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].request.client_payload.source_commit, sha);
  assert.equal(result.targets[0].request.client_payload.version, "0.2.0");
  assert.deepEqual(
    result.report.map((r) => r.status),
    ["missing", "parked"],
  );
  const request = result.targets[0].request;
  client.list = async (url) =>
    url.endsWith("/releases")
      ? [fixture().release]
      : [
          {
            number: 4,
            user: { login: "lapismd-registry-automation[bot]" },
            head: {
              ref: "automation/plugin-history-0.2.0",
              repo: { full_name: "lapismd/plugin-registry" },
            },
            base: { ref: "main" },
            body: `Automated, verified registry update for \`@lapis-notes/history\`.\n\n- Source: \`lapismd/lapis-plugins@${sha}\`\n- Release: \`history@0.2.0\`\n- Asset: \`history-0.2.0.lapis-plugin\``,
          },
        ];
  const pending = await discoverTargets(
    client,
    { recoverMissing: true },
    { trustRoot },
  );
  assert.equal(pending.targets.length, 1);
  assert.deepEqual(pending.targets[0].request, request);
  assert.equal(pending.report[0].status, "pending");
});

test("indexed releases and malformed bot PRs are reported without duplicate recovery", async () => {
  const { client, trustRoot } = fixture();
  const original = client.file;
  client.file = async (repo, ...args) =>
    repo.endsWith("plugin-registry")
      ? {
          versions: {
            "0.2.0": {
              bundle: {
                url: "https://github.com/archive",
                sha256: "1".repeat(64),
                size: 1,
              },
            },
          },
          latestVersion: "0.2.0",
        }
      : original(repo, ...args);
  let result = await discoverTargets(
    client,
    { recoverMissing: true },
    { trustRoot },
  );
  assert.equal(result.targets.length, 0);
  assert.equal(result.report[0].status, "indexed");
  client.list = async () => [
    {
      number: 4,
      user: { login: "lapismd-registry-automation[bot]" },
      head: {
        ref: "automation/plugin-history-0.2.0",
        repo: { full_name: "lapismd/plugin-registry" },
      },
      base: { ref: "main" },
      body: "unreadable",
    },
  ];
  result = await discoverTargets(client, {});
  assert.equal(result.report[0].status, "blocked");
});

test("a merged queued release is not recovered as another PR before publication", async () => {
  const { client, release, trustRoot } = fixture();
  const request = await requestFromPublishedRelease(
    client,
    {
      repository: "lapismd/lapis-plugins",
      packageName: "@lapis-notes/history",
      pluginId: "history",
      version: "0.2.0",
      release,
    },
    trustRoot,
  );
  const read = client.file;
  client.file = async (repo, file, ...args) =>
    file === requestFile(request) ? request : read(repo, file, ...args);
  const result = await discoverTargets(
    client,
    { recoverMissing: true },
    { trustRoot },
  );
  assert.equal(result.targets.length, 0);
  assert.ok(
    result.report.some(
      (item) => item.plugin === "history" && item.status === "queued",
    ),
  );
});

test("published recovery rejects a tag mismatch and an untrusted release key", async () => {
  const { client, release, trustRoot } = fixture();
  const coordinates = {
    repository: "lapismd/lapis-plugins",
    packageName: "@lapis-notes/history",
    pluginId: "history",
    version: "0.2.0",
    release,
  };
  client.tagCommit = async () => "b".repeat(40);
  await assert.rejects(
    requestFromPublishedRelease(client, coordinates, trustRoot),
    /coordinates/,
  );
  client.tagCommit = async () => sha;
  await assert.rejects(
    requestFromPublishedRelease(client, coordinates, {
      keys: [],
      roles: { release: [] },
    }),
    /signature/,
  );
});

test("GitHub collection reads paginate and annotated tags resolve to immutable commits", async () => {
  let pages = 0;
  const client = new GitHubClient("test", async (url) => {
    if (url.includes("per_page"))
      return Response.json(
        Array.from({ length: ++pages === 1 ? 100 : 2 }, (_, i) => i),
      );
    if (url.includes("/git/ref/"))
      return Response.json({ object: { type: "tag", sha: "tag" } });
    return Response.json({ object: { type: "commit", sha } });
  });
  assert.equal(
    (await client.list("/repos/lapismd/plugin-registry/pulls?state=open"))
      .length,
    102,
  );
  assert.equal(
    await client.tagCommit("lapismd/lapis-plugins", "history@0.2.0"),
    sha,
  );
});

test("automatic sweeps skip current PRs while explicit manual selection still verifies them", async () => {
  const request = validateRequest({
    action: "plugin_release",
    client_payload: {
      repository: "lapismd/lapis-plugins",
      package_name: "@lapis-notes/history",
      plugin_id: "history",
      version: "0.2.0",
      release_tag: "history@0.2.0",
      asset_name: "history-0.2.0.lapis-plugin",
      source_commit: sha,
    },
  });
  const entry = {
    source: {
      repository: "lapismd/lapis-plugins",
      packageName: "@lapis-notes/history",
      sourceCommit: sha,
      releaseTag: "history@0.2.0",
    },
    versions: {
      "0.2.0": {
        bundle: {
          url: "https://github.com/archive",
          sha256: "1".repeat(64),
          size: 1,
        },
      },
    },
  };
  const pr = {
    number: 40,
    user: { login: "lapismd-registry-automation[bot]" },
    head: {
      ref: "automation/plugin-history-0.2.0",
      sha: "b".repeat(40),
      repo: { full_name: "lapismd/plugin-registry" },
    },
    base: { ref: "main" },
    body: renderDescription(request, entry),
  };
  let legacy = false;
  const client = {
    call: async (url) =>
      url.includes("/pulls/")
        ? pr
        : url.includes("/compare/")
          ? { merge_base_commit: { sha } }
          : { sha },
    list: async (url) =>
      url.endsWith("/commits")
        ? [{ author: pr.user, committer: pr.user }]
        : url.endsWith("/files")
          ? [
              {
                filename: legacy
                  ? "generated/v2/index.sig"
                  : requestFile(request),
              },
            ]
          : [pr],
    file: async (_repo, file) =>
      file.startsWith("submissions/") ? (legacy ? null : request) : entry,
  };
  const automatic = await discoverTargets(client, {});
  assert.equal(automatic.targets.length, 0);
  assert.equal(automatic.report[0].status, "current");
  const manual = await discoverTargets(client, { prNumber: 40, dryRun: true });
  assert.equal(manual.targets.length, 1);
  assert.equal(manual.targets[0].dryRun, true);
  legacy = true;
  const migration = await discoverTargets(client, {});
  assert.equal(
    migration.targets.length,
    1,
    "legacy generated PRs migrate even when based on current main",
  );
});
