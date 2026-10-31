import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { buildRegistryV2 } from "../lib/catalog-v2.mjs";
import { signJson, verifyJson, readJsonc } from "../lib/registry.mjs";
import {
  requestFromPr,
  requestBranch,
  renderDescription,
  updateDescription,
  validateRequest,
  parseRefreshInputs,
  assertBotPr,
  assertChanges,
  assertSource,
} from "../lib/registry-request.mjs";
import {
  refreshCandidate,
  LeaseConflict,
  compareVersions,
} from "../lib/registry-refresh.mjs";

const sha = "a".repeat(40);
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
const pr = {
  number: 40,
  state: "open",
  user: { login: "lapismd-registry-automation[bot]" },
  head: {
    ref: requestBranch(request),
    sha,
    repo: { full_name: "lapismd/plugin-registry" },
  },
  base: { ref: "main" },
};
const image = (name) => ({
  alt: `${name} [screen]`,
  images: {
    preview: {
      sha256: name,
      sourceUrl: `https://raw.githubusercontent.com/lapismd/lapis-plugins/${sha}/packages/history/registry-assets/${name}.preview.webp`,
    },
    full: {
      sourceUrl: `https://raw.githubusercontent.com/lapismd/lapis-plugins/${sha}/packages/history/registry-assets/${name}.full.webp`,
    },
  },
});

test("legacy and structured requests retain exact release coordinates", () => {
  const legacy = `Automated, verified registry update for \`@lapis-notes/history\`.\n\n- Source: \`lapismd/lapis-plugins@${sha}\`\n- Release: \`history@0.2.0\`\n- Asset: \`history-0.2.0.lapis-plugin\``;
  assert.deepEqual(requestFromPr({ ...pr, body: legacy }), request);
  const body = renderDescription(request, {});
  assert.deepEqual(requestFromPr({ ...pr, body }), request);
  assert.throws(
    () =>
      requestFromPr({
        ...pr,
        head: { ...pr.head, ref: "automation/plugin-other-0.2.0" },
        body,
      }),
    /branch/,
  );
  assert.throws(
    () =>
      requestFromPr({
        ...pr,
        body: body.replace('"schemaVersion": 1', '"schemaVersion": 99'),
      }),
    /schema/,
  );
});

test("image descriptions are pinned, ordered, deduplicated and preserve human notes", () => {
  const entry = {
    media: { banner: image("banner"), overview: image("overview") },
    gallery: [image("one"), image("banner")],
  };
  const rendered = renderDescription(request, entry);
  assert.ok(rendered.indexOf("banner.preview") < rendered.indexOf("<details>"));
  assert.ok(
    rendered.indexOf("overview.preview") < rendered.indexOf("one.preview"),
  );
  assert.equal(rendered.match(/banner.preview/g).length, 1);
  assert.match(rendered, /banner \\\[screen\\\]/);
  assert.doesNotMatch(rendered, /registry\.lapis\.md/);
  const body = `Maintainer note\n\n${rendered}\n\nKeep this too`;
  const updated = updateDescription(body, request, {});
  assert.ok(updated.startsWith("Maintainer note"));
  assert.ok(updated.endsWith("Keep this too"));
  assert.doesNotMatch(updated, /<details>/);
  assert.equal(updateDescription(updated, request, {}), updated);
  assert.throws(
    () =>
      renderDescription(request, {
        media: {
          banner: {
            ...image("bad"),
            images: {
              preview: { sourceUrl: "https://example.com/unpinned.webp" },
            },
          },
        },
      }),
    /pinned/,
  );
});

test("manual selection rejects invalid inputs and incompatible recovery selection", () => {
  assert.deepEqual(parseRefreshInputs({ pr_number: "40", dry_run: true }), {
    prNumber: 40,
    dryRun: true,
    recoverMissing: false,
  });
  assert.throws(
    () => parseRefreshInputs({ pr_number: "40; exit 0" }),
    /PR number/,
  );
  assert.throws(
    () =>
      parseRefreshInputs({ pr_number: "40", recover_missing_releases: true }),
    /combine/,
  );
  assert.throws(() => parseRefreshInputs({ dry_run: "yes" }), /boolean/);
});

test("only owned bot branches, generated paths and matching source coordinates qualify", () => {
  assertBotPr(pr);
  assert.throws(() => assertBotPr({ ...pr, user: { login: "human" } }), /bot/);
  assert.throws(
    () =>
      assertBotPr({
        ...pr,
        head: { ...pr.head, repo: { full_name: "other/fork" } },
      }),
    /repository/,
  );
  assertChanges(
    request,
    [{ author: pr.user, committer: { login: "github-actions[bot]" } }],
    ["generated/v2/index.sig", "entries/official/history.jsonc"],
  );
  assert.throws(
    () => assertChanges(request, [{ author: { login: "human" } }], []),
    /human/,
  );
  assert.throws(
    () => assertChanges(request, [], ["scripts/sign-registry.mjs"]),
    /Unexpected/,
  );
  assertSource(request, {
    source: {
      repository: "lapismd/lapis-plugins",
      packageName: "@lapis-notes/history",
      sourceCommit: sha,
      releaseTag: "history@0.2.0",
    },
    versions: { "0.2.0": {} },
  });
  assert.throws(() => assertSource(request, { source: {} }), /coordinates/);
});

test("after merging A, refreshing B regenerates a valid signed catalog retaining A and B", async () => {
  const fixture = await readJsonc(
    new URL("../../entries/official/history.jsonc", import.meta.url),
  );
  const a = { ...fixture, id: "plugin-a" },
    b = { ...fixture, id: "history" };
  const mainEntries = [a];
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  let published;
  const result = await refreshCandidate(
    { request, prNumber: 40 },
    {
      snapshot: async () => ({
        mainSha: "merged-a",
        headSha: "old-b",
        state: "open",
        request,
        entry: null,
        baseEntry: null,
      }),
      verify: async () => {},
      build: async () => {
        const index = buildRegistryV2([...mainEntries, b]).index;
        return {
          index,
          signature: signJson(index, privateKey, "lapis-registry-test").sidecar,
        };
      },
      publish: async (candidate) => {
        published = candidate;
      },
    },
  );
  assert.equal(result.status, "updated");
  assert.deepEqual(published.index.plugins.map((p) => p.id).sort(), [
    "history",
    "plugin-a",
  ]);
  assert.equal(
    verifyJson(published.index, published.signature, publicKey),
    true,
  );
});

test("refresh retries moving main and lease races without overwriting newer requests", async () => {
  let snapshots = 0,
    publishes = 0;
  const state = () => ({
    mainSha: snapshots++ === 0 ? "old" : "new",
    headSha: "head",
    request,
    state: "open",
    entry: null,
    baseEntry: null,
  });
  const result = await refreshCandidate(
    { request, prNumber: 40 },
    {
      snapshot: async () => state(),
      verify: async () => {},
      build: async () => ({}),
      publish: async () => {
        if (++publishes === 1) throw new LeaseConflict();
      },
    },
  );
  assert.equal(result.status, "updated");
  assert.equal(publishes, 2);
  const newer = validateRequest({
    ...request,
    client_payload: {
      ...request.client_payload,
      source_commit: "b".repeat(40),
    },
  });
  const skipped = await refreshCandidate(
    { request, prNumber: 40 },
    { snapshot: async () => ({ request: newer, state: "open" }) },
  );
  assert.equal(skipped.status, "superseded");
});

test("closed, indexed, conflicting and dry-run candidates cannot write branches", async () => {
  const target = { request, prNumber: 40 };
  const closed = await refreshCandidate(target, {
    snapshot: async () => ({ state: "closed" }),
  });
  assert.equal(closed.status, "closed");
  let verified = 0;
  const adapter = {
    snapshot: async () => ({
      state: "open",
      request,
      mainSha: sha,
      headSha: sha,
      entry: null,
      baseEntry: null,
    }),
    verify: async () => {
      verified++;
    },
    publish: () => assert.fail("must not publish"),
  };
  assert.equal(
    (await refreshCandidate({ ...target, dryRun: true }, adapter)).status,
    "verified",
  );
  assert.equal(verified, 1);
  adapter.snapshot = async () => ({
    state: "open",
    request,
    entry: {
      versions: {
        "0.2.0": {
          bundle: {
            url: "https://github.com/archive",
            sha256: "1".repeat(64),
            size: 1,
          },
        },
      },
    },
    baseEntry: null,
  });
  assert.equal((await refreshCandidate(target, adapter)).status, "indexed");
  adapter.snapshot = async () => ({
    state: "open",
    request,
    entry: { latestVersion: "0.3.0" },
    baseEntry: null,
  });
  await assert.rejects(refreshCandidate(target, adapter), /downgrade/);
  adapter.snapshot = async () => ({
    state: "open",
    request,
    entry: { changed: true },
    baseEntry: null,
  });
  await assert.rejects(refreshCandidate(target, adapter), /curated/);
});

test("version ordering preserves SemVer prerelease and build semantics", () => {
  for (const [left, right] of [
    ["1.0.0-alpha", "1.0.0-alpha.1"],
    ["1.0.0-2", "1.0.0-10"],
    ["1.0.0-rc.1", "1.0.0"],
    ["1.9.0", "1.10.0"],
  ])
    assert.equal(compareVersions(left, right), -1);
  assert.equal(compareVersions("1.0.0+one", "1.0.0+two"), 0);
});

test("legacy metadata requests carry no release fields and human committers block refresh", () => {
  const body = `Automated, verified registry update for \`@lapis-notes/history\`.\n\n- Source: \`lapismd/lapis-plugins@${sha}\`\n- Release: \`metadata-only\`\n- Asset: \`unchanged\``;
  const metadata = requestFromPr({
    ...pr,
    head: { ...pr.head, ref: "automation/plugin-history-metadata" },
    body,
  });
  assert.equal(metadata.action, "plugin_metadata");
  assert.deepEqual(Object.keys(metadata.client_payload).sort(), [
    "package_name",
    "plugin_id",
    "repository",
    "source_commit",
  ]);
  assert.throws(
    () =>
      assertChanges(
        request,
        [{ author: pr.user, committer: { login: "human" } }],
        [],
      ),
    /human/,
  );
});

test("a pending version is not mistaken for an indexed installable release", async () => {
  const entry = {
    latestVersion: "0.2.0",
    versions: { "0.2.0": { bundle: { status: "pending" } } },
  };
  let published = 0;
  const result = await refreshCandidate(
    { request, prNumber: 40 },
    {
      snapshot: async () => ({
        state: "open",
        request,
        mainSha: sha,
        headSha: sha,
        entry,
        baseEntry: entry,
      }),
      verify: async () => {},
      build: async () => ({}),
      publish: async () => {
        published++;
      },
    },
  );
  assert.equal(result.status, "updated");
  assert.equal(published, 1);
});
