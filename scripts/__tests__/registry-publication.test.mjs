import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  requestFile,
  registryBot,
  registryRepository,
} from "../lib/registry-request.mjs";
import {
  parseSubmission,
  loadSubmissions,
  writeSubmission,
  orderSubmissions,
  applySubmissions,
} from "../lib/registry-submissions.mjs";
import {
  publicationBranch,
  publicationDescription,
  publicationRecords,
  assertPublicationPr,
  publishQueuedSubmissions,
} from "../lib/registry-publication.mjs";
import { buildRegistryV2 } from "../lib/catalog-v2.mjs";
import { signJson, verifyJson } from "../lib/registry.mjs";
import { LeaseConflict } from "../lib/registry-refresh.mjs";
import { createPublicationRunner } from "../lib/registry-publication-runner.mjs";
import { createRegistryRunner } from "../lib/registry-runner.mjs";
import { renderDescription, requestBranch } from "../lib/registry-request.mjs";

function request(
  id = "search",
  version = "0.1.4",
  repository = "lapismd/lapis-plugins",
) {
  return {
    schemaVersion: 1,
    action: "plugin_release",
    client_payload: {
      repository,
      package_name: `@lapis-notes/${id}`,
      plugin_id: id,
      version,
      source_commit: "a".repeat(40),
      release_tag: `${id}@${version}`,
      asset_name: `${id}-${version}.lapis-plugin`,
    },
  };
}
const record = (id, version, repository) => {
  const req = request(id, version, repository);
  return { request: req, file: requestFile(req) };
};
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "lapis-registry-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return pathToFileURL(`${directory}/`);
}
function entry(id, version) {
  return {
    schemaVersion: 1,
    id,
    name: id,
    author: "Lapis Notes",
    description: "Plugin",
    categories: ["editing"],
    channel: "official",
    owner: { name: "Lapis Notes", verified: true },
    status: "active",
    minAppVersion: "0.1.0",
    platforms: ["web"],
    latestVersion: version,
    versions: {
      [version]: {
        version,
        minAppVersion: "0.1.0",
        platforms: ["web"],
        releasedAt: "2026-10-31T12:00:00Z",
        bundle: {
          url: `https://github.com/lapismd/lapis-plugins/releases/download/${id}%40${version}/${id}-${version}.lapis-plugin`,
          sha256: "1".repeat(64),
          size: 10,
        },
      },
    },
  };
}

function metadataRequest(commit) {
  return {
    schemaVersion: 1,
    action: "plugin_metadata",
    client_payload: {
      repository: "lapismd/lapis-plugins",
      package_name: "@lapis-notes/search",
      plugin_id: "search",
      source_commit: commit,
    },
  };
}
async function writeEntry(root, value) {
  const target = new URL(`entries/official/${value.id}.jsonc`, root);
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, JSON.stringify(value));
}

test("a submission is one small coordinate record and standalone repositories use the same contract", async (t) => {
  const root = await fixture(t);
  const req = request("tasks", "0.1.0", "lapismd/lapis-plugin-tasks");
  const file = await writeSubmission(req, root);
  assert.equal(file, "submissions/tasks/0.1.0.jsonc");
  const text = await readFile(new URL(file, root), "utf8");
  assert.ok(text.length < 600);
  assert.deepEqual(await loadSubmissions(root), [{ file, request: req }]);
  assert.equal(text.includes("signatures"), false);
  assert.throws(
    () => parseSubmission({ ...req, generated: {} }, file),
    /Invalid submission/,
  );
  assert.throws(
    () => parseSubmission(req, "submissions/search/0.1.0.jsonc"),
    /coordinates/,
  );
  assert.throws(
    () => parseSubmission({ ...req, schemaVersion: 2 }, file),
    /Invalid submission/,
  );
});

test("separate submissions merge without shared files and one publication signs both releases", async (t) => {
  const root = await fixture(t);
  const a = record("search"),
    b = record("bookmarks");
  // Merging A writes exactly A's new file. B's unchanged PR writes a different file.
  await writeSubmission(a.request, root);
  await writeSubmission(b.request, root);
  assert.notEqual(a.file, b.file);
  const records = await loadSubmissions(root);
  assert.equal(records.length, 2);
  await assert.rejects(readFile(new URL("generated/v2/index.json", root)), {
    code: "ENOENT",
  });
  const entries = [];
  await applySubmissions(records, {
    root,
    replay: async (item) => {
      const p = item.request.client_payload,
        value = entry(p.plugin_id, p.version);
      entries.push(value);
      await writeEntry(root, value);
    },
  });
  const registry = buildRegistryV2(entries);
  assert.deepEqual(registry.index.plugins.map((p) => p.id).sort(), [
    "bookmarks",
    "search",
  ]);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signed = signJson(
    registry.index,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    "lapis-registry-test",
  );
  assert.equal(
    verifyJson(
      registry.index,
      signed.sidecar,
      publicKey.export({ type: "spki", format: "pem" }),
    ),
    true,
  );
  assert.deepEqual(await loadSubmissions(root), []);
});

test("separate versions of one plugin queue independently and publish in SemVer order", async (t) => {
  const root = await fixture(t);
  const records = [record("search", "0.10.0"), record("search", "0.2.0")];
  for (const item of records) await writeSubmission(item.request, root);
  const versions = [];
  await applySubmissions(records, {
    root,
    replay: async (item) => {
      versions.push(item.request.client_payload.version);
      await writeEntry(
        root,
        entry("search", item.request.client_payload.version),
      );
    },
  });
  assert.deepEqual(versions, ["0.2.0", "0.10.0"]);
  assert.throws(() => orderSubmissions([records[0], records[0]]), /Duplicate/);
});

test("publication preserves indexed artifacts, rejects replacements and blocks downgrades", async (t) => {
  const root = await fixture(t),
    item = record("search"),
    existing = entry("search", "0.1.4");
  await writeEntry(root, existing);
  await writeSubmission(item.request, root);
  let replays = 0;
  await applySubmissions([item], {
    root,
    verify: async () => ({ entry: existing }),
    replay: async () => {
      replays++;
    },
  });
  assert.equal(replays, 0);
  assert.deepEqual(await loadSubmissions(root), []);
  await writeSubmission(item.request, root);
  const replacement = structuredClone(existing);
  replacement.versions["0.1.4"].bundle.sha256 = "2".repeat(64);
  await assert.rejects(
    applySubmissions([item], {
      root,
      verify: async () => ({ entry: replacement }),
    }),
    /replace an indexed/,
  );
  assert.equal((await loadSubmissions(root)).length, 1);
  const older = record("search", "0.1.3");
  await writeSubmission(older.request, root);
  await assert.rejects(applySubmissions([older], { root }), /downgrade/);
});

test("older queued metadata cannot overwrite newer presentation and divergent history needs reconciliation", async (t) => {
  const root = await fixture(t),
    request = metadataRequest("a".repeat(40));
  const item = { request, file: requestFile(request) };
  const existing = {
    ...entry("search", "0.1.4"),
    source: {
      repository: "lapismd/lapis-plugins",
      packageName: "@lapis-notes/search",
      sourceCommit: "b".repeat(40),
    },
  };
  await writeEntry(root, existing);
  await writeSubmission(request, root);
  let verifications = 0;
  await applySubmissions([item], {
    root,
    compareSources: async () => "behind",
    verify: async () => {
      verifications++;
    },
    replay: () => assert.fail("older metadata must not replace newer content"),
  });
  assert.equal(verifications, 1);
  assert.deepEqual(
    JSON.parse(
      await readFile(new URL("entries/official/search.jsonc", root), "utf8"),
    ),
    existing,
  );
  assert.deepEqual(await loadSubmissions(root), []);
  await writeSubmission(request, root);
  await assert.rejects(
    applySubmissions([item], { root, compareSources: async () => "diverged" }),
    /divergent/,
  );
  assert.equal((await loadSubmissions(root)).length, 1);
});

test("a later metadata dispatch can create a new submission after the preceding metadata PR merged", async () => {
  const old = metadataRequest("a".repeat(40)),
    next = metadataRequest("b".repeat(40));
  const oldEntry = {
    source: {
      repository: old.client_payload.repository,
      packageName: old.client_payload.package_name,
      sourceCommit: old.client_payload.source_commit,
    },
  };
  const previous = {
    number: 52,
    state: "closed",
    merged_at: "2026-11-01T00:00:00Z",
    user: { login: registryBot },
    head: {
      ref: requestBranch(old),
      sha: "head",
      repo: { full_name: registryRepository },
    },
    base: { ref: "main" },
    body: renderDescription(old, {}),
  };
  const client = {
    call: async (url) =>
      url.includes("/commits/main")
        ? { sha: "main" }
        : url.includes("/git/ref/")
          ? { object: { sha: "head" } }
          : url.includes("main...head")
            ? {
                total_commits: 0,
                commits: [],
                files: [],
                merge_base_commit: { sha: "base" },
              }
            : { status: "ahead" },
    list: async () => [previous],
    file: async (_repo, file, ref) =>
      file.startsWith("entries/")
        ? oldEntry
        : ref === "head" && file === requestFile(old)
          ? old
          : null,
  };
  const snapshot = await createRegistryRunner(
    client,
    { request: next },
    "/tmp/registry-metadata-snapshot",
  ).snapshot();
  assert.equal(snapshot.state, "open");
  assert.equal(snapshot.pr, null);
  assert.equal(snapshot.headSha, "head");
});

test("publication records and notes survive updates, while human edits and unexpected files block publication", () => {
  const records = [record("search")];
  const body = publicationDescription("", records);
  assert.deepEqual(publicationRecords(body), records);
  assert.ok(
    publicationDescription("", records, "f".repeat(40)).includes(
      `/blob/${"f".repeat(40)}/${records[0].file}`,
    ),
  );
  const updated = publicationDescription(
    `Maintainer note\n\n${body}\n\nReview later`,
    [...records, record("bookmarks")],
  );
  assert.ok(updated.startsWith("Maintainer note"));
  assert.ok(updated.endsWith("Review later"));
  const pr = {
    user: { login: registryBot },
    head: { ref: publicationBranch, repo: { full_name: registryRepository } },
    base: { ref: "main" },
    body,
  };
  const commits = [
    { author: { login: registryBot }, committer: { login: registryBot } },
  ];
  const files = [
    { filename: records[0].file, status: "removed" },
    { filename: "entries/official/search.jsonc", status: "modified" },
    { filename: "generated/v2/index.sig", status: "modified" },
  ];
  assert.deepEqual(assertPublicationPr(pr, commits, files), records);
  assert.throws(
    () => assertPublicationPr(pr, [{ author: { login: "maintainer" } }], files),
    /human/,
  );
  for (const file of [
    "generated/v1/index.json",
    "scripts/evil.mjs",
    "entries/official/other.jsonc",
  ])
    assert.throws(
      () => assertPublicationPr(pr, commits, [...files, { filename: file }]),
      /Unexpected/,
    );
  assert.throws(
    () =>
      assertPublicationPr(pr, commits, [
        { filename: records[0].file, status: "modified" },
      ]),
    /Unexpected/,
  );
  assert.throws(() => publicationRecords(""), /unique managed/);
  assert.throws(
    () => publicationDescription("human body", records),
    /Malformed/,
  );
});

test("publication dry runs and empty queues do not write, and moving main or leases retry at most three times", async () => {
  const snapshot = {
    mainSha: "main",
    headSha: "head",
    records: [record("search")],
  };
  let builds = 0,
    writes = 0,
    reads = 0;
  const adapter = {
    snapshot: async () => snapshot,
    verify: async () => {},
    build: async () => {
      builds++;
      return {};
    },
    publish: async () => {
      writes++;
      return { number: 52 };
    },
  };
  assert.equal(
    (await publishQueuedSubmissions(adapter, { dryRun: true })).status,
    "verified",
  );
  assert.equal(builds, 0);
  assert.equal(writes, 0);
  assert.equal(
    (
      await publishQueuedSubmissions({
        ...adapter,
        snapshot: async () => ({ records: [] }),
      })
    ).status,
    "empty",
  );
  const result = await publishQueuedSubmissions({
    ...adapter,
    snapshot: async () => ({
      ...snapshot,
      mainSha: ++reads === 1 ? "old" : "main",
    }),
  });
  assert.equal(result.prNumber, 52);
  assert.equal(builds, 2);
  assert.equal(writes, 1);
  builds = 0;
  writes = 0;
  await assert.rejects(
    publishQueuedSubmissions({
      ...adapter,
      publish: async () => {
        writes++;
        throw new LeaseConflict("race");
      },
    }),
    /kept changing/,
  );
  assert.equal(builds, 3);
  assert.equal(writes, 3);
  await assert.rejects(
    publishQueuedSubmissions({
      ...adapter,
      verify: async () => {
        throw new Error("Invalid archive");
      },
    }),
    /Invalid archive/,
  );
  reads = 0;
  builds = 0;
  writes = 0;
  const discoveryRace = await publishQueuedSubmissions({
    ...adapter,
    snapshot: async () => {
      if (++reads === 1)
        throw new LeaseConflict("branch changed during discovery");
      return snapshot;
    },
  });
  assert.equal(discoveryRace.status, "updated");
  assert.equal(reads, 3);
  assert.equal(builds, 1);
  assert.equal(writes, 1);
});

test("publication resumes an attributable bot branch after a crash and rejects unknown or human branches", async (t) => {
  const root = await fixture(t),
    item = record("search");
  let human = false,
    total = 1;
  const client = {
    call: async (url) =>
      url.includes("/git/trees/")
        ? { tree: [{ type: "blob", path: item.file }] }
        : url.includes("/git/ref/")
          ? { object: { sha: "head" } }
          : url.includes("/compare/")
            ? {
                total_commits: total,
                commits: [
                  {
                    author: { login: human ? "maintainer" : registryBot },
                    committer: { login: registryBot },
                  },
                ],
                files: [{ filename: item.file, status: "removed" }],
              }
            : { sha: "main" },
    list: async () => [],
    file: async () => item.request,
  };
  const runner = createPublicationRunner(client, root.pathname.slice(0, -1));
  assert.equal((await runner.snapshot()).headSha, "head");
  human = true;
  await assert.rejects(runner.snapshot(), /human/);
  human = false;
  total = 0;
  await assert.rejects(runner.snapshot(), /Unattributed/);
});

test("publication discovery rejects truncated queues, closed PRs, human commits and request tampering", async (t) => {
  const root = await fixture(t),
    records = [record("search")];
  let pr = null,
    human = false,
    truncated = false,
    curatedChanged = false,
    files = [{ filename: records[0].file, status: "removed" }];
  const client = {
    call: async (url) =>
      url.includes("/git/trees/")
        ? {
            truncated,
            tree: records.map((item) => ({ path: item.file, type: "blob" })),
          }
        : url.includes("/git/ref/")
          ? pr
            ? { object: { sha: "head" } }
            : null
          : url.includes("/compare/")
            ? { merge_base_commit: { sha: "base" } }
            : { sha: "main" },
    list: async (url) =>
      url.endsWith("/commits")
        ? [
            {
              author: { login: human ? "maintainer" : registryBot },
              committer: { login: registryBot },
            },
          ]
        : url.endsWith("/files")
          ? files
          : pr
            ? [pr]
            : [],
    file: async (_repo, file, ref) =>
      file.startsWith("entries/")
        ? {
            description:
              curatedChanged && ref === "main"
                ? "Maintainer curation"
                : "Original",
          }
        : records.find((item) => item.file === file)?.request,
  };
  const runner = createPublicationRunner(client, root.pathname.slice(0, -1));
  assert.equal((await runner.snapshot()).records.length, 1);
  pr = {
    number: 52,
    state: "open",
    user: { login: registryBot },
    head: {
      ref: publicationBranch,
      sha: "head",
      repo: { full_name: registryRepository },
    },
    base: { ref: "main" },
    body: publicationDescription("", records),
  };
  assert.equal((await runner.snapshot()).pr.number, 52);
  curatedChanged = true;
  await assert.rejects(runner.snapshot(), /curated entry changed/);
  curatedChanged = false;
  human = true;
  await assert.rejects(runner.snapshot(), /human/);
  human = false;
  truncated = true;
  await assert.rejects(runner.snapshot(), /truncated/);
  truncated = false;
  pr.state = "closed";
  await assert.rejects(runner.snapshot(), /closed without merging/);
  pr.merged_at = "2026-11-01T00:00:00Z";
  assert.equal(
    (await runner.snapshot()).pr,
    undefined,
    "a later batch creates a new PR after the former publication merged",
  );
  pr.state = "open";
  const changed = structuredClone(records);
  changed[0].request.client_payload.source_commit = "b".repeat(40);
  pr.body = publicationDescription("", changed);
  await assert.rejects(runner.snapshot(), /identity changed/);
  pr.body = publicationDescription("", records);
  files = [...files, { filename: "scripts/changed.mjs", status: "modified" }];
  await assert.rejects(runner.snapshot(), /Unexpected/);
});
