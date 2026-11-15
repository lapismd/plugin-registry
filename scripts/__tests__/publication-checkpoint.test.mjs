import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { zipSync, unzipSync } from "fflate";
import {
  encodeCheckpoint,
  decodeCheckpoint,
  downloadCheckpoint,
  digest,
  checkpointName,
} from "../lib/publication-checkpoint.mjs";
import { verifyCheckpointProducer } from "../lib/publication-producer.mjs";
import { buildReceipt, receiptMessage } from "../lib/publication-receipt.mjs";
import {
  publishQueuedSubmissions,
  publishCheckpoint,
} from "../lib/registry-publication.mjs";
import {
  requestFile,
  registryBot,
  registryRepository,
} from "../lib/registry-request.mjs";
const sourceSha = "a".repeat(40),
  treeSha = "b".repeat(40);
const request = {
  schemaVersion: 1,
  action: "plugin_release",
  client_payload: {
    repository: "lapismd/lapis-plugins",
    package_name: "@lapis-notes/search",
    plugin_id: "search",
    version: "0.1.4",
    source_commit: "c".repeat(40),
    release_tag: "search@0.1.4",
    asset_name: "search-0.1.4.lapis-plugin",
  },
};
const records = [{ request, file: requestFile(request) }];
const before = () => ({ mainSha: sourceSha, headSha: "", records, pr: null });
function candidate() {
  const receipt = buildReceipt({
    sourceSha,
    treeSha,
    records,
    node: "24.15.0",
    packageManager: "pnpm@10.32.1",
    runId: "123",
    runAttempt: 1,
  });
  const identity = `${registryBot} <123+${registryBot}@users.noreply.github.com> 1700000000 +0000`;
  const commitObject = Buffer.from(
    `tree ${treeSha}\nparent ${sourceSha}\nauthor ${identity}\ncommitter ${identity}\n\n${receiptMessage(receipt)}\n`,
  );
  const sha = createHash("sha1")
    .update(`commit ${commitObject.byteLength}\0`)
    .update(commitObject)
    .digest("hex");
  return { receipt, sha, commitObject };
}
function checkpoint() {
  const { sha, commitObject } = candidate();
  return encodeCheckpoint({
    snapshot: before(),
    candidateSha: sha,
    commitObject,
    patch: Buffer.from("qualified public diff\n"),
    files: [
      { filename: records[0].file, status: "removed" },
      {
        filename: "generated/v2/index.json",
        status: "modified",
        mode: "100644",
      },
    ].sort((a, b) => a.filename.localeCompare(b.filename)),
    producer: { runId: "123", runAttempt: 1, sourceSha },
  });
}
function producer(archive) {
  let run = {
    id: 123,
    run_attempt: 1,
    head_sha: sourceSha,
    head_branch: "main",
    repository: { full_name: registryRepository },
    path: ".github/workflows/publish-registry-updates.yml",
    event: "push",
    status: "completed",
    conclusion: "success",
  };
  let artifact = {
    id: 17,
    name: checkpointName("123", 1),
    expired: false,
    workflow_run: { id: 123, head_sha: sourceSha },
    digest: `sha256:${digest(archive)}`,
    size_in_bytes: archive.byteLength,
  };
  let job = {
    name: "prepare",
    status: "completed",
    conclusion: "success",
    steps: [{ name: "Publication decision: prepared", conclusion: "success" }],
  };
  const client = {
    call: async (path) =>
      path.includes("/jobs?")
        ? { jobs: [job] }
        : path.includes("/artifacts?")
          ? {
              artifacts: artifact ? [artifact] : [],
              total_count: artifact ? 1 : 0,
            }
          : path.includes("/artifacts/")
            ? artifact
            : run,
  };
  return {
    client,
    setRun: (value) => {
      run = { ...run, ...value };
    },
    setArtifact: (value) => {
      artifact = value === null ? null : { ...artifact, ...value };
    },
    setJob: (value) => {
      job = { ...job, ...value };
    },
  };
}
const coordinates = {
  runId: "123",
  runAttempt: 1,
  sourceSha,
  artifactId: "17",
};

test("checkpoint contains only exact public diff and fixed commit bytes, with stable artifact hashing", () => {
  const packed = checkpoint(),
    decoded = decodeCheckpoint(packed.bytes, packed.digest);
  assert.equal(decoded.manifest.candidateSha, candidate().sha);
  assert.equal(decoded.receipt.treeSha, treeSha);
  assert.equal(decoded.manifest.producer.runId, "123");
  assert.deepEqual(Object.keys(unzipSync(packed.bytes)).sort(), [
    "candidate.commit",
    "candidate.patch",
    "manifest.json",
  ]);
  assert.equal(checkpoint().digest, packed.digest);
  assert.throws(
    () => decodeCheckpoint(packed.bytes, "0".repeat(64)),
    /hash\/size/,
  );
});

test("mutated payload, unsafe/config paths, symlinks and unknown members fail before restoration", () => {
  const packed = checkpoint();
  for (const mutation of [
    (files) => {
      files["candidate.patch"] = Buffer.from("mutated");
    },
    (files) => {
      files["credentials.env"] = Buffer.from("forbidden");
    },
    (files) => {
      const m = JSON.parse(Buffer.from(files["manifest.json"]));
      m.files[1].filename = ".git/config";
      files["manifest.json"] = Buffer.from(JSON.stringify(m));
    },
    (files) => {
      const m = JSON.parse(Buffer.from(files["manifest.json"]));
      m.files[1].filename = "generated/v2/assets/../../.env";
      files["manifest.json"] = Buffer.from(JSON.stringify(m));
    },
    (files) => {
      const m = JSON.parse(Buffer.from(files["manifest.json"]));
      m.files[1].mode = "120000";
      files["manifest.json"] = Buffer.from(JSON.stringify(m));
    },
    (files) => {
      const m = JSON.parse(Buffer.from(files["manifest.json"]));
      m.sourceSha = treeSha;
      files["manifest.json"] = Buffer.from(JSON.stringify(m));
    },
  ]) {
    const files = unzipSync(packed.bytes);
    mutation(files);
    const bytes = zipSync(files);
    assert.throws(
      () => decodeCheckpoint(bytes, digest(bytes)),
      /mutation|Unsafe|Unexpected|non-public|non-regular|identity|payload|input/,
    );
  }
});

test("download requires successful exact producer attempt/job and immutable Actions archive digest", async () => {
  const packed = checkpoint(),
    archive = zipSync({ "candidate.zip": packed.bytes }),
    p = producer(archive);
  const restored = await downloadCheckpoint(p.client, coordinates, {
    fetchImpl: async () => new Response(archive),
  });
  assert.equal(restored.artifactId, 17);
  assert.equal(restored.manifest.candidateSha, candidate().sha);
  await assert.rejects(
    downloadCheckpoint(p.client, coordinates, {
      fetchImpl: async () => new Response(Buffer.from("wrong bytes")),
    }),
    /digest mismatch/,
  );
  p.setRun({ conclusion: "failure" });
  await assert.rejects(
    downloadCheckpoint(p.client, coordinates, {
      fetchImpl: () => assert.fail("unqualified download"),
    }),
    /not successful/,
  );
});

test("missing/wrong/expired artifact and stale producer evidence cannot trigger publication", async () => {
  const packed = checkpoint(),
    archive = zipSync({ "candidate.zip": packed.bytes });
  for (const mutate of [
    (p) => p.setArtifact({ expired: true }),
    (p) => p.setArtifact({ name: checkpointName("123", 2) }),
    (p) => p.setArtifact({ digest: null }),
    (p) => p.setArtifact({ workflow_run: { id: 123, head_sha: treeSha } }),
    (p) => p.setRun({ run_attempt: 2 }),
    (p) => p.setRun({ head_branch: "repair" }),
    (p) => p.setJob({ conclusion: "failure" }),
  ]) {
    const p = producer(archive);
    mutate(p);
    await assert.rejects(
      downloadCheckpoint(p.client, coordinates, {
        fetchImpl: () => assert.fail("no archive read before qualification"),
      }),
      /provenance|qualified|unavailable|successful|mismatch/,
    );
  }
  const p = producer(archive);
  p.setArtifact(null);
  await assert.rejects(
    downloadCheckpoint(p.client, { ...coordinates, artifactId: undefined }),
    /missing or ambiguous/,
  );
});

test("dry/no-op preparation decisions are explicit and cannot masquerade as qualified candidates", async () => {
  const packed = checkpoint(),
    archive = zipSync({ "candidate.zip": packed.bytes }),
    p = producer(archive);
  p.setJob({
    steps: [{ name: "Publication decision: verified", conclusion: "success" }],
  });
  assert.equal(
    (await verifyCheckpointProducer(p.client, coordinates)).publicationDecision,
    "verified",
  );
  await assert.rejects(
    downloadCheckpoint(p.client, coordinates),
    /did not create/,
  );
});

test("failed remote upload resumes from durable candidate without repeating qualification or signing", async () => {
  let verified = 0,
    built = 0,
    writes = 0,
    installed = 0,
    durable;
  const c = candidate();
  let state = before();
  const adapter = {
    snapshot: async () => state,
    verify: async () => {
      verified++;
    },
    build: async () => {
      built++;
      return { sha: c.sha };
    },
    checkpoint: async () => {
      durable = checkpoint();
      return { digest: durable.digest };
    },
    installCheckpoint: async (restored) => {
      installed++;
      assert.equal(restored.manifest.candidateSha, c.sha);
      return { sha: c.sha };
    },
    publish: async () => {
      writes++;
      if (writes === 1) throw Error("uncertain remote upload");
      state = { ...state, headSha: c.sha, pr: { number: 52 } };
      return state.pr;
    },
    reuse: async () =>
      state.pr ? { sha: c.sha, descriptionCurrent: true } : null,
  };
  const prepared = await publishQueuedSubmissions(adapter, {
    prepareOnly: true,
  });
  assert.equal(prepared.status, "prepared");
  assert.equal(writes, 0, "artifact must exist before any remote publication");
  await publishQueuedSubmissions(
    {
      ...adapter,
      reuse: async () => ({ sha: c.sha, descriptionCurrent: false }),
    },
    { prepareOnly: true },
  );
  assert.equal(
    verified,
    1,
    "duplicate preparation reuses durable qualification before a branch exists",
  );
  assert.equal(built, 1);
  assert.equal(writes, 0);
  const restored = decodeCheckpoint(durable.bytes, durable.digest);
  await assert.rejects(
    publishCheckpoint(adapter, restored),
    /uncertain remote upload/,
  );
  assert.equal(writes, 1, "no blind upload retry");
  const resumed = await publishCheckpoint(
    adapter,
    decodeCheckpoint(durable.bytes, durable.digest),
  );
  assert.equal(resumed.prNumber, 52);
  assert.equal(verified, 1);
  assert.equal(built, 1);
  assert.equal(installed, 2);
  assert.equal(writes, 2);
  assert.equal(
    (await publishCheckpoint(adapter, restored)).status,
    "unchanged",
  );
  assert.equal(
    writes,
    2,
    "duplicate dispatch does not create a second publication",
  );
});

test("artifact restoration checks actual patch paths before an isolated index and never checks out candidate code", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { createPublicationRunner } = await import(
    "../lib/registry-publication-runner.mjs"
  );
  const directory = await mkdtemp(`${tmpdir()}/registry-restore-test-`);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = {
    GITHUB_ACTIONS: "true",
    REGISTRY_PUBLICATION_STAGE: "publish",
    GITHUB_SHA: sourceSha,
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: registryRepository,
    GITHUB_WORKFLOW_REF: `${registryRepository}/.github/workflows/write-registry-publication.yml@refs/heads/main`,
  };
  const old = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let wrongPath = true,
    wrongTree = false;
  const calls = [];
  const execute = async (_name, args, options) => {
    calls.push({ args, isolated: !!options.env.GIT_INDEX_FILE });
    let stdout = "";
    if (args.includes("--numstat"))
      stdout = wrongPath
        ? "1\t0\t.git/config\0"
        : `1\t1\tgenerated/v2/index.json\0` + `0\t1\t${records[0].file}\0`;
    else if (args.includes("--summary"))
      stdout = ` delete mode 100644 ${records[0].file}\n`;
    else if (args[0] === "diff" && args.includes("--cached"))
      stdout = `M\0generated/v2/index.json\0D\0${records[0].file}\0`;
    else if (args[0] === "ls-files")
      stdout = `100644 ${sourceSha} 0\tgenerated/v2/index.json\n`;
    else if (args[0] === "write-tree")
      stdout = `${wrongTree ? sourceSha : treeSha}\n`;
    else if (args[0] === "hash-object") stdout = `${candidate().sha}\n`;
    return {
      stdout: options.encoding === "buffer" ? Buffer.from(stdout) : stdout,
    };
  };
  const runner = createPublicationRunner({}, directory, {
    execute,
    runtime: async () => ({
      sourceSha,
      node: "24.15.0",
      packageManager: "pnpm@10.32.1",
    }),
  });
  const packed = checkpoint(),
    decoded = decodeCheckpoint(packed.bytes, packed.digest);
  await assert.rejects(
    runner.installCheckpoint(decoded, before()),
    /Patch paths/,
  );
  assert(!calls.some((call) => call.args[0] === "read-tree"));
  wrongPath = false;
  wrongTree = true;
  calls.length = 0;
  await assert.rejects(
    runner.installCheckpoint(decoded, before()),
    /tree\/path mutation/,
  );
  assert(!calls.some((call) => call.args[0] === "hash-object"));
  wrongTree = false;
  calls.length = 0;
  assert.equal(
    (await runner.installCheckpoint(decoded, before())).sha,
    candidate().sha,
  );
  assert(
    calls
      .filter(
        (call) =>
          ["read-tree", "write-tree", "ls-files"].includes(call.args[0]) ||
          (call.args[0] === "apply" && call.args.includes("--cached")),
      )
      .every((call) => call.isolated),
  );
  assert(
    !calls.some((call) =>
      ["checkout", "reset", "push", "commit"].includes(call.args[0]),
    ),
  );
  process.env.REGISTRY_PUBLICATION_STAGE = "prepare";
  process.env.GITHUB_WORKFLOW_REF = `${registryRepository}/.github/workflows/publish-registry-updates.yml@refs/heads/main`;
  const preparer = createPublicationRunner({}, directory, {
    execute,
    runtime: async () => ({
      sourceSha,
      node: "24.15.0",
      packageManager: "pnpm@10.32.1",
    }),
    reuseCheckpoint: async () => decoded,
  });
  assert.equal((await preparer.reuse(before())).sha, candidate().sha);
});

test("no publication write path accepts a different execution workflow or source", async () => {
  const { createPublicationRunner } = await import(
    "../lib/registry-publication-runner.mjs"
  );
  const runner = createPublicationRunner(
    {
      call: () =>
        assert.fail("no API writes or reads before trusted writer guard"),
    },
    "/unused",
    { runtime: async () => ({ sourceSha }) },
  );
  await assert.rejects(
    runner.publish({ sha: candidate().sha }, before()),
    /exact trusted writer/,
  );
});

test("preparation discovers an earlier successful exact-source artifact before repeating qualification", async () => {
  const { findQualifiedCheckpoint } = await import(
    "../lib/publication-checkpoint.mjs"
  );
  const packed = checkpoint(),
    archive = zipSync({ "candidate.zip": packed.bytes }),
    p = producer(archive);
  const client = {
    call: async (path) =>
      path.includes("/workflows/")
        ? { workflow_runs: [{ id: 123, run_attempt: 1 }] }
        : p.client.call(path),
  };
  let downloads = 0;
  const found = await findQualifiedCheckpoint(client, before(), {
    currentRunId: "456",
    fetchImpl: async () => {
      downloads++;
      return new Response(archive);
    },
  });
  assert.equal(found.manifest.candidateSha, candidate().sha);
  assert.equal(downloads, 1);
});
