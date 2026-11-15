import { createHash } from "node:crypto";
import { registryBot, registryRepository } from "./registry-request.mjs";
import { orderSubmissions, recordKey } from "./registry-submissions.mjs";
import { stableStringify } from "./registry.mjs";
import { LeaseConflict } from "./registry-refresh.mjs";

export const publicationBranch = "automation/publish-registry";
const start = "<!-- lapis-registry-publication:start -->";
const end = "<!-- lapis-registry-publication:end -->";

export function publicationRecords(body = "") {
  const matches = [
    ...body.matchAll(
      /<!-- lapis-registry-publication-record\n([\s\S]*?)\n-->/g,
    ),
  ];
  if (matches.length !== 1)
    throw new Error("Publication PR has no unique managed record.");
  const record = JSON.parse(matches[0][1]);
  if (record.schemaVersion !== 1 || !Array.isArray(record.submissions))
    throw new Error("Invalid publication record.");
  return orderSubmissions(record.submissions);
}

export function publicationIdentity(records) {
  return stableStringify(
    orderSubmissions(records).map((record) => ({
      file: record.file,
      request: JSON.parse(recordKey(record)),
    })),
    0,
  );
}

export function assertPublicationPr(pr, commits, files) {
  if (
    pr.user?.login !== registryBot ||
    pr.head?.repo?.full_name !== registryRepository ||
    pr.head.ref !== publicationBranch ||
    pr.base?.ref !== "main"
  )
    throw new Error("Publication branch is not owned by the registry bot.");
  if (
    commits.some(
      (commit) =>
        commit.author?.login !== registryBot ||
        commit.committer?.login !== registryBot,
    )
  )
    throw new Error(
      "Publication PR contains human or unattributed commits; reconcile manually.",
    );
  const records = publicationRecords(pr.body);
  const entries = new Set(
    records.map(
      (record) =>
        `entries/official/${record.request.client_payload.plugin_id}.jsonc`,
    ),
  );
  const queue = new Set(records.map((record) => record.file));
  for (const file of files) {
    for (const filename of [file.filename, file.previous_filename].filter(
      Boolean,
    )) {
      if (
        filename.startsWith("generated/v2/") ||
        filename === "generated/download-targets.mjs" ||
        entries.has(filename)
      ) {
        continue;
      }
      if (queue.has(filename) && file.status === "removed") continue;
      throw new Error(`Unexpected publication change: ${filename}`);
    }
  }
  return records;
}

export function publicationDescription(body, records, sourceRef = "main") {
  const managed = [
    start,
    "This PR publishes verified plugin submissions that maintainers have merged into the registry queue. It updates the curated entries, mirrors their declared images, regenerates the catalog and signs its metadata together.",
    ...orderSubmissions(records).map(({ request, file }) => {
      const p = request.client_payload;
      return `- **${p.plugin_id} ${p.version ?? "metadata"}** — [queued request](https://github.com/${registryRepository}/blob/${sourceRef}/${file}) · [verified source](https://github.com/${p.repository}/commit/${p.source_commit})`;
    }),
    "Merge this PR to publish this batch through the existing production deployment gate. New submissions are collected into this same open PR automatically.",
    `<!-- lapis-registry-publication-record\n${JSON.stringify({ schemaVersion: 1, submissions: orderSubmissions(records) }, null, 2)}\n-->`,
    end,
  ].join("\n\n");
  if (!body) return managed;
  if (
    body.split(start).length !== 2 ||
    body.split(end).length !== 2 ||
    body.indexOf(start) > body.indexOf(end)
  )
    throw new Error("Malformed managed publication description.");
  return (
    body.slice(0, body.indexOf(start)) +
    managed +
    body.slice(body.indexOf(end) + end.length)
  );
}

export async function publishQueuedSubmissions(
  adapter,
  { dryRun = false, prepareOnly = false, onProgress = async () => {} } = {},
) {
  let prepared, preparedIdentity;
  const metrics = {
    verifyMs: 0,
    buildMs: 0,
    attempts: 0,
    reusedCandidate: false,
  };
  const measure = async (phase, work) => {
    const start = Date.now();
    try {
      return await work();
    } finally {
      metrics[phase] += Date.now() - start;
      Object.assign(metrics, adapter.metrics?.() ?? {});
      await onProgress({ metrics: { ...metrics } });
    }
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      metrics.attempts++;
      const before = await adapter.snapshot();
      const inputIdentity = JSON.stringify([
        before.mainSha,
        publicationIdentity(before.records),
      ]);
      const batchIdentity = createHash("sha256")
        .update(inputIdentity)
        .digest("hex");
      await onProgress({
        phase: "discovered",
        batchIdentity,
        sourceSha: before.mainSha,
        count: before.records.length,
        metrics: { ...metrics },
      });
      if (!before.records.length)
        return { status: "empty", sourceSha: before.mainSha, metrics };
      if (!dryRun) {
        const reused = await adapter.reuse?.(before);
        if (
          reused?.pending &&
          prepared?.sha === before.headSha &&
          preparedIdentity === inputIdentity
        )
          reused.pending = false;
        if (
          reused?.pending ||
          (reused && before.pr && reused.descriptionCurrent !== false)
        ) {
          const latest = await adapter.snapshot();
          if (
            before.mainSha !== latest.mainSha ||
            before.headSha !== latest.headSha ||
            before.pr?.number !== latest.pr?.number ||
            publicationIdentity(before.records) !==
              publicationIdentity(latest.records)
          )
            continue;
          return {
            status: reused.pending ? "qualification-pending" : "unchanged",
            count: before.records.length,
            prNumber: before.pr?.number,
            candidateSha: before.headSha,
            sourceSha: before.mainSha,
            batchIdentity,
            metrics: { ...metrics, reusedCandidate: true },
          };
        }
        if (reused) {
          prepared = reused;
          preparedIdentity = inputIdentity;
          metrics.reusedCandidate = true;
        }
      }
      if (dryRun || !prepared || preparedIdentity !== inputIdentity) {
        await onProgress({ phase: "verifying" });
        await measure("verifyMs", () => adapter.verify(before));
        await onProgress({ phase: "verified", metrics: { ...metrics } });
        if (dryRun)
          return {
            status: "verified",
            count: before.records.length,
            sourceSha: before.mainSha,
            batchIdentity,
            metrics,
          };
        prepared = await measure("buildMs", () => adapter.build(before));
        preparedIdentity = inputIdentity;
        await onProgress({
          phase: "qualified",
          candidateSha: prepared.sha,
          metrics: { ...metrics },
        });
      } else metrics.reusedCandidate = true;
      const candidate = prepared;
      const latest = await adapter.snapshot();
      if (
        before.mainSha !== latest.mainSha ||
        before.headSha !== latest.headSha ||
        before.pr?.number !== latest.pr?.number ||
        publicationIdentity(before.records) !==
          publicationIdentity(latest.records)
      ) {
        console.warn(
          `Publication state moved during attempt ${attempt + 1}/3; rebuilding from the new snapshot.`,
        );
        continue;
      }
      if (prepareOnly) {
        const checkpoint = await adapter.checkpoint(candidate, latest);
        return {
          status: "prepared",
          sourceSha: before.mainSha,
          candidateSha: candidate.sha,
          count: before.records.length,
          batchIdentity,
          checkpointDigest: checkpoint.digest,
          metrics,
        };
      }
      await onProgress({
        phase: "publishing",
        candidateSha: candidate.sha,
        metrics: { ...metrics },
      });
      const pr = await adapter.publish(candidate, latest);
      return {
        status: "updated",
        count: before.records.length,
        prNumber: pr.number,
        sourceSha: before.mainSha,
        candidateSha: candidate.sha,
        batchIdentity,
        metrics,
      };
    } catch (error) {
      if (!(error instanceof LeaseConflict)) throw error;
      console.warn(`Publication retry ${attempt + 1}/3: ${error.message}`);
    }
  }
  throw new Error(
    "Registry publication kept changing; retry the publication workflow.",
  );
}

export async function pushQualifiedCandidate(
  candidateSha,
  expectedSha,
  { push, readHead },
) {
  if (candidateSha === expectedSha) return { status: "already-accepted" };
  try {
    await push();
    return { status: "accepted" };
  } catch (error) {
    if ((await readHead()) === candidateSha)
      return { status: "accepted-after-readback" };
    if (/stale info|fetch first|non-fast-forward/.test(error.stderr ?? ""))
      throw new LeaseConflict(
        "Publication branch lease was rejected; reconcile current state.",
      );
    throw Error(
      "Publication push outcome is uncertain; inspect the exact branch/PR before re-dispatching. No write was retried.",
    );
  }
}

export async function publishCheckpoint(
  adapter,
  checkpoint,
  { onProgress = async () => {} } = {},
) {
  const before = await adapter.snapshot(),
    manifest = checkpoint.manifest;
  if (
    before.mainSha !== manifest.sourceSha ||
    publicationIdentity(before.records) !==
      publicationIdentity(manifest.records)
  )
    throw Error(
      "Qualified artifact source/queue changed; prepare a fresh candidate.",
    );
  const same = await adapter.reuse?.(before);
  if (same?.pending || (same && before.pr && same.descriptionCurrent !== false))
    return {
      status: same.pending ? "qualification-pending" : "unchanged",
      sourceSha: before.mainSha,
      candidateSha: before.headSha,
      prNumber: before.pr?.number,
      count: before.records.length,
      batchIdentity: manifest.batchIdentity,
      metrics: { verifyMs: 0, buildMs: 0, attempts: 1, reusedCandidate: true },
    };
  let candidate;
  if (same) candidate = same;
  else {
    if (
      ![manifest.expectedHead, manifest.candidateSha].includes(before.headSha)
    )
      throw new LeaseConflict(
        "Publication head changed after candidate qualification; preserve current ownership.",
      );
    candidate = await adapter.installCheckpoint(checkpoint, before);
  }
  await onProgress({
    phase: "publishing",
    sourceSha: before.mainSha,
    candidateSha: candidate.sha,
    batchIdentity: manifest.batchIdentity,
    artifactId: checkpoint.artifactId,
    artifactDigest: checkpoint.artifactDigest,
  });
  const pr = await adapter.publish(candidate, before);
  return {
    status: "updated",
    sourceSha: before.mainSha,
    candidateSha: candidate.sha,
    batchIdentity: manifest.batchIdentity,
    prNumber: pr.number,
    count: before.records.length,
    metrics: { verifyMs: 0, buildMs: 0, attempts: 1, reusedCandidate: true },
  };
}
