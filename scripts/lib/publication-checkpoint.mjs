import {
  resolveCheckpointArtifact,
  verifyCheckpointProducer,
  checkpointLimit,
  checkpointName,
} from "./publication-producer.mjs";
import { createHash } from "node:crypto";
import { unzipSync, zipSync } from "fflate";
import {
  assertPublicationPr,
  publicationDescription,
} from "./registry-publication.mjs";
import {
  readReceipt,
  receiptMessage,
  batchIdentity,
  assertReceiptRun,
} from "./publication-receipt.mjs";
import { registryRepository, registryBot } from "./registry-request.mjs";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const isSha = (value) => /^[a-f0-9]{40}$/.test(value ?? "");
const isDigest = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
export function assertPublicChanges(records, files) {
  if (records.length > 1024 || files.length > 4096)
    throw Error("Candidate file/queue count exceeds its bounds.");
  const paths = new Set();
  assertPublicationPr(
    {
      user: { login: registryBot },
      head: {
        ref: "automation/publish-registry",
        repo: { full_name: registryRepository },
      },
      base: { ref: "main" },
      body: publicationDescription("", records),
    },
    [],
    files,
  );
  for (const file of files) {
    const path = file.filename;
    if (
      paths.has(path) ||
      path.includes("\\") ||
      path.split("/").some((p) => p === ".." || p.startsWith(".")) ||
      !Object.keys(file).every((key) =>
        ["filename", "status", "mode"].includes(key),
      ) ||
      (file.mode !== undefined && file.mode !== "100644") ||
      !["removed", "modified"].includes(file.status)
    )
      throw Error("Unsafe or duplicate candidate path.");
    paths.add(path);
    const allowed =
      path.startsWith("entries/official/") ||
      path.startsWith("submissions/") ||
      path === "generated/download-targets.mjs" ||
      /^generated\/v2\/(?:index|revoked)\.(?:json|sig)$/.test(path) ||
      /^generated\/v2\/plugins\/[a-z0-9-]+\.(?:json|sig)$/.test(path) ||
      path === "generated/v2/trust/root.json" ||
      /^generated\/v2\/assets\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpe?g|gif|svg|avif)$/.test(
        path,
      ) ||
      /^generated\/v2\/content\/[a-zA-Z0-9_./-]+\.md$/.test(path);
    if (!allowed || (file.status !== "removed" && file.mode !== "100644"))
      throw Error("Candidate contains a non-public path or non-regular file.");
  }
  if (
    records.some(
      (record) =>
        !files.some(
          (file) => file.filename === record.file && file.status === "removed",
        ),
    )
  )
    throw Error(
      "Qualified candidate does not consume its exact approved queue.",
    );
}
export function receiptFromObject(commitObject) {
  const text = Buffer.from(commitObject).toString("utf8");
  const split = text.indexOf("\n\n"),
    headers = text.slice(0, split).split("\n");
  if (
    split < 0 ||
    headers.length !== 4 ||
    !headers[0].startsWith("tree ") ||
    !headers[1].startsWith("parent ") ||
    !headers[2].startsWith(`author ${registryBot} <`) ||
    !headers[3].startsWith(`committer ${registryBot} <`)
  )
    throw Error("Candidate commit has unexpected identity or headers.");
  const sourceSha = headers[1].slice(7),
    treeSha = headers[0].slice(5);
  const receipt = readReceipt({
    parents: [{ sha: sourceSha }],
    commit: { message: text.slice(split + 2), tree: { sha: treeSha } },
  });
  if (!receipt || text.slice(split + 2) !== receiptMessage(receipt) + "\n")
    throw Error(
      "Qualified candidate receipt missing or unexpected commit bytes.",
    );
  const publicIdentity = (line) => {
    const match =
      /^(?:author|committer) (.+) <([^<>]+)> [0-9]+ [+-][0-9]{4}$/.exec(line);
    const id = match?.[2].split("+")[0];
    return (
      match?.[1] === registryBot &&
      /^[0-9]+$/.test(id ?? "") &&
      match[2] === `${id}+${registryBot}@users.noreply.github.com`
    );
  };
  if (!publicIdentity(headers[2]) || !publicIdentity(headers[3]))
    throw Error("Candidate commit contains non-public author identity.");
  return receipt;
}
export function encodeCheckpoint({
  snapshot,
  candidateSha,
  commitObject,
  patch,
  files,
  producer,
}) {
  const receipt = receiptFromObject(commitObject);
  const manifest = {
    schemaVersion: 1,
    kind: "lapis-registry-candidate",
    sourceSha: snapshot.mainSha,
    candidateSha,
    expectedHead: snapshot.headSha,
    batchIdentity: batchIdentity(snapshot.mainSha, snapshot.records),
    records: snapshot.records,
    files,
    producer,
    patchSha256: digest(patch),
    commitSha256: digest(commitObject),
  };
  const bytes = zipSync(
    {
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "candidate.commit": commitObject,
      "candidate.patch": patch,
    },
    { mtime: new Date(1980, 0, 1), level: 6 },
  );
  decodeCheckpoint(bytes, digest(bytes));
  return { bytes, digest: digest(bytes), manifest, receipt };
}
export function decodeCheckpoint(bytes, expectedDigest) {
  if (
    !isDigest(expectedDigest) ||
    bytes.byteLength > checkpointLimit ||
    digest(bytes) !== expectedDigest
  )
    throw Error("Qualified artifact hash/size mismatch.");
  const expected = ["manifest.json", "candidate.commit", "candidate.patch"];
  let total = 0;
  const members = new Set();
  const payload = unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize;
      if (members.has(file.name)) throw Error("Duplicate checkpoint member.");
      members.add(file.name);
      if (!expected.includes(file.name) || total > checkpointLimit)
        throw Error("Unexpected or oversized checkpoint member.");
      return true;
    },
  });
  if (Object.keys(payload).sort().join() !== expected.sort().join())
    throw Error("Incomplete qualified checkpoint.");
  if (
    payload["manifest.json"].byteLength > 1024 * 1024 ||
    payload["candidate.commit"].byteLength > 65536 ||
    Object.values(payload).reduce((sum, value) => sum + value.byteLength, 0) >
      checkpointLimit
  )
    throw Error("Decoded checkpoint payload exceeds its bounds.");
  const manifest = JSON.parse(
    Buffer.from(payload["manifest.json"]).toString("utf8"),
  );
  if (
    !manifest ||
    Object.keys(manifest).sort().join() !==
      [
        "schemaVersion",
        "kind",
        "sourceSha",
        "candidateSha",
        "expectedHead",
        "batchIdentity",
        "records",
        "files",
        "producer",
        "patchSha256",
        "commitSha256",
      ]
        .sort()
        .join() ||
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "lapis-registry-candidate" ||
    !isSha(manifest.sourceSha) ||
    !isSha(manifest.candidateSha) ||
    (manifest.expectedHead !== "" && !isSha(manifest.expectedHead)) ||
    !Array.isArray(manifest.records) ||
    !Array.isArray(manifest.files) ||
    manifest.records.some(
      (record) => Object.keys(record).sort().join() !== "file,request",
    ) ||
    Object.keys(manifest.producer ?? {})
      .sort()
      .join() !== "runAttempt,runId,sourceSha" ||
    !/^\d+$/.test(manifest.producer?.runId ?? "") ||
    !Number.isSafeInteger(manifest.producer?.runAttempt) ||
    manifest.producer.runAttempt < 1 ||
    manifest.producer.sourceSha !== manifest.sourceSha
  )
    throw Error("Invalid qualified checkpoint identity.");
  const commitObject = Buffer.from(payload["candidate.commit"]),
    patch = Buffer.from(payload["candidate.patch"]);
  if (
    manifest.patchSha256 !== digest(patch) ||
    manifest.commitSha256 !== digest(commitObject) ||
    manifest.batchIdentity !==
      batchIdentity(manifest.sourceSha, manifest.records)
  )
    throw Error("Checkpoint payload/input mutation.");
  const objectHash = createHash("sha1")
    .update(`commit ${commitObject.byteLength}\0`)
    .update(commitObject)
    .digest("hex");
  const receipt = receiptFromObject(commitObject);
  if (
    objectHash !== manifest.candidateSha ||
    receipt.sourceSha !== manifest.sourceSha ||
    receipt.batchIdentity !== manifest.batchIdentity
  )
    throw Error("Checkpoint commit/qualification mutation.");
  assertPublicChanges(manifest.records, manifest.files);
  return { manifest, receipt, commitObject, patch, digest: expectedDigest };
}
export {
  verifyCheckpointProducer,
  resolveCheckpointArtifact,
  checkpointLimit,
  checkpointName,
} from "./publication-producer.mjs";
export async function downloadCheckpoint(
  client,
  coordinates,
  { token = "", fetchImpl = fetch } = {},
) {
  const artifact = await resolveCheckpointArtifact(client, coordinates);
  const response = await fetchImpl(
    `https://api.github.com/repos/${registryRepository}/actions/artifacts/${artifact.id}/zip`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(120000),
    },
  );
  if (!response.ok)
    throw Error(
      "Qualified artifact download failed; no publication attempted.",
    );
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > checkpointLimit) {
      void reader.cancel().catch(() => {});
      throw Error("Qualified artifact download too large.");
    }
    chunks.push(value);
  }
  const archive = Buffer.concat(chunks, size);
  if (`sha256:${digest(archive)}` !== artifact.digest)
    throw Error("Immutable Actions artifact digest mismatch.");
  const seen = new Set();
  const entries = unzipSync(archive, {
    filter: (file) => {
      if (file.name !== "candidate.zip" || file.originalSize > checkpointLimit)
        throw Error("Unexpected artifact member.");
      return true;
    },
  });
  if (Object.keys(entries).join() !== "candidate.zip")
    throw Error("Qualified candidate file missing.");
  const candidate = entries["candidate.zip"];
  const checkpoint = decodeCheckpoint(candidate, digest(candidate));
  if (
    checkpoint.manifest.producer.runId !== String(coordinates.runId) ||
    checkpoint.manifest.producer.runAttempt !==
      Number(coordinates.runAttempt) ||
    checkpoint.manifest.sourceSha !== coordinates.sourceSha
  )
    throw Error("Checkpoint producer mutation.");
  return {
    ...checkpoint,
    artifactId: artifact.id,
    artifactDigest: artifact.digest,
  };
}

export async function findQualifiedCheckpoint(
  client,
  snapshot,
  { currentRunId, token = "", fetchImpl = fetch } = {},
) {
  for (let page = 1; page <= 20; page++) {
    const result = await client.call(
      `/repos/${registryRepository}/actions/workflows/publish-registry-updates.yml/runs?head_sha=${snapshot.mainSha}&status=success&per_page=100&page=${page}`,
    );
    if (!Array.isArray(result.workflow_runs))
      throw Error("Unknown prior qualification coverage.");
    for (const run of result.workflow_runs) {
      if (String(run.id) === String(currentRunId)) continue;
      const coordinates = {
        runId: String(run.id),
        runAttempt: run.run_attempt,
        sourceSha: snapshot.mainSha,
      };
      const producer = await verifyCheckpointProducer(client, coordinates);
      if (producer.publicationDecision !== "prepared") continue;
      const checkpoint = await downloadCheckpoint(client, coordinates, {
        token,
        fetchImpl,
      });
      if (
        checkpoint.manifest.batchIdentity !==
        batchIdentity(snapshot.mainSha, snapshot.records)
      )
        throw Error(
          "Prior qualified artifact queue differs from exact current source.",
        );
      return checkpoint;
    }
    if (result.workflow_runs.length < 100) return null;
  }
  throw Error(
    "Prior qualification history is incomplete; inspect before preparing another candidate.",
  );
}
