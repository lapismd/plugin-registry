import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReceipt,
  readReceipt,
  receiptMessage,
  reusableReceipt,
  assertReceiptRun,
  batchIdentity,
} from "../lib/publication-receipt.mjs";
import { createSubmissionFetchCache } from "../lib/submission-fetch-cache.mjs";
import {
  publishQueuedSubmissions,
  pushQualifiedCandidate,
} from "../lib/registry-publication.mjs";
import {
  requestFile,
  registryRepository,
  registryBot,
} from "../lib/registry-request.mjs";
import { LeaseConflict } from "../lib/registry-refresh.mjs";
import { createPublicationRunner } from "../lib/registry-publication-runner.mjs";
const sourceSha = "a".repeat(40),
  treeSha = "b".repeat(40),
  candidateSha = "c".repeat(40);
function record(id = "search") {
  const request = {
    schemaVersion: 1,
    action: "plugin_release",
    client_payload: {
      repository: "lapismd/lapis-plugins",
      package_name: `@lapis-notes/${id}`,
      plugin_id: id,
      version: "0.1.4",
      source_commit: "d".repeat(40),
      release_tag: `${id}@0.1.4`,
      asset_name: `${id}-0.1.4.lapis-plugin`,
    },
  };
  return { file: requestFile(request), request };
}
const runtime = { sourceSha, node: "24.15.0", packageManager: "pnpm@10.32.1" };
const records = [record()];
const receipt = () =>
  buildReceipt({ ...runtime, treeSha, records, runId: "123", runAttempt: 1 });
const commit = () => ({
  sha: candidateSha,
  author: { login: registryBot },
  committer: { login: registryBot },
  parents: [{ sha: sourceSha }],
  commit: { message: receiptMessage(receipt()), tree: { sha: treeSha } },
});
const snapshot = () => ({ mainSha: sourceSha, headSha: candidateSha, records });
const run = () => ({
  id: 123,
  run_attempt: 1,
  head_sha: sourceSha,
  head_branch: "main",
  repository: { full_name: registryRepository },
  path: ".github/workflows/publish-registry-updates.yml",
  event: "push",
  status: "completed",
  conclusion: "success",
});

test("immutable receipts bind exact queue/source/tree/runtime and reject malformed or altered provenance", () => {
  assert.deepEqual(readReceipt(commit()), receipt());
  assert.equal(
    readReceipt({ commit: { message: "legacy bot candidate" } }),
    null,
  );
  const altered = commit();
  altered.commit.tree.sha = sourceSha;
  assert.throws(() => readReceipt(altered), /tree\/source/);
  const parent = commit();
  parent.parents[0].sha = treeSha;
  assert.throws(() => readReceipt(parent), /tree\/source/);
  const duplicate = commit();
  duplicate.commit.message += `\n${receiptMessage(receipt()).split("\n").at(-1)}`;
  assert.throws(() => readReceipt(duplicate), /Ambiguous/);
  assert.equal(reusableReceipt(receipt(), snapshot(), runtime), true);
  for (const changed of [
    { ...runtime, sourceSha: treeSha },
    { ...runtime, node: "24.16.0" },
    { ...runtime, packageManager: "pnpm@10.33.0" },
  ])
    assert.equal(reusableReceipt(receipt(), snapshot(), changed), false);
  assert.equal(
    reusableReceipt(
      receipt(),
      { ...snapshot(), records: [...records, record("bookmarks")] },
      runtime,
    ),
    false,
  );
  assert.equal(
    batchIdentity(sourceSha, [...records, record("bookmarks")]),
    batchIdentity(sourceSha, [record("bookmarks"), ...records]),
  );
});

test("receipt authority requires exact originating trusted main workflow attempt, not rerun actor", () => {
  assert.equal(assertReceiptRun(receipt(), run()), true);
  assert.equal(
    assertReceiptRun(receipt(), { ...run(), status: "in_progress" }),
    false,
  );
  assert.throws(
    () => assertReceiptRun(receipt(), { ...run(), conclusion: "failure" }),
    /not successful/,
  );
  for (const changed of [
    { path: ".github/workflows/other.yml" },
    { head_sha: treeSha },
    { head_branch: "repair" },
    { event: "pull_request" },
    { run_attempt: 2 },
    { repository: { full_name: "lapismd/other" } },
  ])
    assert.throws(
      () => assertReceiptRun(receipt(), { ...run(), ...changed }),
      /provenance/,
    );
});

test("production runner wires receipt reuse and rejects human authors without invoking build/signing", async () => {
  let current = commit(),
    reads = 0;
  const client = { call: async () => current };
  const runner = createPublicationRunner(client, "/unused-read-only", {
    runtime: async () => runtime,
    readRun: async () => {
      reads++;
      return run();
    },
  });
  assert.equal((await runner.reuse(snapshot())).sha, candidateSha);
  assert.equal(reads, 1);
  current.author.login = "human";
  await assert.rejects(runner.reuse(snapshot()), /Unattributed/);
  current = { commit: { message: "legacy" } };
  assert.equal(await runner.reuse(snapshot()), null);
});

test("snapshot cache coalesces verified bytes and separates authorization/accept variants", async () => {
  let calls = 0;
  const cached = createSubmissionFetchCache(async () => {
    calls++;
    return new Response("signed-bytes");
  });
  const options = {
    headers: {
      Authorization: "test-only-credential",
      Accept: "application/octet-stream",
    },
  };
  const responses = await Promise.all([
    cached("https://example.test/asset", options),
    cached("https://example.test/asset", options),
  ]);
  assert.deepEqual(await Promise.all(responses.map((r) => r.text())), [
    "signed-bytes",
    "signed-bytes",
  ]);
  assert.equal(
    await (await cached("https://example.test/asset", options)).text(),
    "signed-bytes",
  );
  await cached("https://example.test/asset", {
    headers: { Accept: "application/json" },
  });
  assert.equal(calls, 2);
  assert.equal(cached.metrics().hits, 2);
  assert(!JSON.stringify(cached.metrics()).includes("credential"));
});

test("failed, aborted and bounded oversized reads never become shared cached authority", async () => {
  let calls = 0;
  const cached = createSubmissionFetchCache(
    async () => {
      calls++;
      return new Response("oversized-response", {
        status: calls === 1 ? 503 : 200,
      });
    },
    { maxEntryBytes: 4, maxBytes: 8 },
  );
  for (let i = 0; i < 3; i++)
    await (await cached("https://example.test/asset")).text();
  assert.equal(calls, 3);
  assert.equal(cached.metrics().retainedBytes, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    cached("https://example.test/asset", { signal: controller.signal }),
    /abort/i,
  );
  assert.equal(calls, 3);
});

test("qualified orphan resumes only its missing PR operation and running origin waits", async () => {
  let writes = 0;
  const adapter = {
    snapshot: async () => snapshot(),
    reuse: async () => ({ sha: candidateSha }),
    verify: () => assert.fail("no repeated downloads"),
    build: () => assert.fail("no repeated signing"),
    publish: async (candidate) => {
      assert.equal(candidate.sha, candidateSha);
      writes++;
      return { number: 52 };
    },
  };
  const result = await publishQueuedSubmissions(adapter);
  assert.equal(result.status, "updated");
  assert.equal(writes, 1);
  assert.equal(result.metrics.reusedCandidate, true);
  const pending = await publishQueuedSubmissions({
    ...adapter,
    reuse: async () => ({ sha: candidateSha, pending: true }),
  });
  assert.equal(pending.status, "qualification-pending");
  assert.equal(writes, 1);
});

test("uncertain push is read back once; accepted ref resumes and unresolved writes never retry", async () => {
  let pushes = 0,
    reads = 0;
  const push = async () => {
    pushes++;
    throw Error("timeout after acceptance");
  };
  assert.equal(
    (
      await pushQualifiedCandidate(candidateSha, sourceSha, {
        push,
        readHead: async () => {
          reads++;
          return candidateSha;
        },
      })
    ).status,
    "accepted-after-readback",
  );
  assert.equal(pushes, 1);
  assert.equal(reads, 1);
  await assert.rejects(
    pushQualifiedCandidate(candidateSha, sourceSha, {
      push,
      readHead: async () => sourceSha,
    }),
    /uncertain/,
  );
  assert.equal(pushes, 2);
  assert.equal(
    (
      await pushQualifiedCandidate(candidateSha, candidateSha, {
        push,
        readHead: () => assert.fail("already accepted"),
      })
    ).status,
    "already-accepted",
  );
  await assert.rejects(
    pushQualifiedCandidate(candidateSha, sourceSha, {
      push: async () => {
        const e = Error("rejected");
        e.stderr = "stale info";
        throw e;
      },
      readHead: async () => sourceSha,
    }),
    LeaseConflict,
  );
});

test("partial publication failure retains qualified phase/identity and does not replay uncertain PR writes", async () => {
  const phases = [];
  let builds = 0,
    writes = 0;
  await assert.rejects(
    publishQueuedSubmissions(
      {
        snapshot: async () => ({ ...snapshot(), headSha: "" }),
        verify: async () => {},
        build: async () => {
          builds++;
          return { sha: candidateSha };
        },
        publish: async () => {
          writes++;
          throw Error("uncertain PR creation");
        },
      },
      { onProgress: async (value) => phases.push(value) },
    ),
    /uncertain PR/,
  );
  assert.equal(builds, 1);
  assert.equal(writes, 1);
  assert.equal(phases.at(-1).phase, "publishing");
  assert.equal(phases.at(-1).candidateSha, candidateSha);
});

test("a concurrent qualified winner stops lease retries without replacing its running branch", async () => {
  let builds = 0,
    writes = 0;
  const result = await publishQueuedSubmissions({
    snapshot: async () => ({
      ...snapshot(),
      headSha: writes ? candidateSha : "",
    }),
    reuse: async (state) =>
      state.headSha ? { sha: candidateSha, pending: true } : null,
    verify: async () => {},
    build: async () => {
      builds++;
      return { sha: "e".repeat(40) };
    },
    publish: async () => {
      writes++;
      throw new LeaseConflict("another bot won");
    },
  });
  assert.equal(result.status, "qualification-pending");
  assert.equal(builds, 1);
  assert.equal(writes, 1);
});

test("concurrent different assets cannot exceed the snapshot retained-byte budget", async () => {
  const cached = createSubmissionFetchCache(async () => new Response("ab"), {
    maxBytes: 2,
    maxEntryBytes: 2,
  });
  const responses = await Promise.all([
    cached("https://example.test/a"),
    cached("https://example.test/b"),
  ]);
  assert.deepEqual(await Promise.all(responses.map((r) => r.text())), [
    "ab",
    "ab",
  ]);
  assert.equal(cached.metrics().retainedBytes, 2);
});
