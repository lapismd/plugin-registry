#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GitHubClient } from "./lib/github-client.mjs";
import { createPublicationRunner } from "./lib/registry-publication-runner.mjs";
import {
  downloadCheckpoint,
  findQualifiedCheckpoint,
} from "./lib/publication-checkpoint.mjs";
import { verifyCheckpointProducer } from "./lib/publication-producer.mjs";
import {
  publishQueuedSubmissions,
  publishCheckpoint,
} from "./lib/registry-publication.mjs";

let progress = {
  schemaVersion: 1,
  kind: "lapis-registry-publication",
  observedAt: new Date().toISOString(),
  phase: "starting",
  status: "running",
  stage: process.env.REGISTRY_PUBLICATION_STAGE ?? "prepare",
  workflowRunId: process.env.GITHUB_RUN_ID ?? null,
  runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 0),
};
async function report(update) {
  progress = { ...progress, ...update, observedAt: new Date().toISOString() };
  await mkdir("tmp", { recursive: true });
  await writeFile(
    "tmp/publication-report.json",
    JSON.stringify(progress, null, 2) + "\n",
  );
}
try {
  const stage = process.env.REGISTRY_PUBLICATION_STAGE ?? "prepare";
  const artifactClient = new GitHubClient(
    process.env.REGISTRY_ARTIFACT_TOKEN ?? "",
  );
  const runner = createPublicationRunner(
    new GitHubClient(),
    fileURLToPath(new URL("../", import.meta.url)),
    stage === "prepare"
      ? {
          reuseCheckpoint: (snapshot) =>
            findQualifiedCheckpoint(artifactClient, snapshot, {
              currentRunId: process.env.GITHUB_RUN_ID,
              token: process.env.REGISTRY_ARTIFACT_TOKEN,
            }),
        }
      : {},
  );
  let result;
  if (stage === "prepare") {
    result = await publishQueuedSubmissions(runner, {
      dryRun: process.env.REGISTRY_DRY_RUN === "true",
      prepareOnly: true,
      onProgress: report,
    });
    if (process.env.GITHUB_OUTPUT)
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `status=${result.status}\ncheckpoint_digest=${result.checkpointDigest ?? ""}\n`,
      );
  } else if (stage === "publish") {
    const coordinates = {
      runId: process.env.REGISTRY_PRODUCER_RUN_ID,
      runAttempt: Number(process.env.REGISTRY_PRODUCER_RUN_ATTEMPT),
      sourceSha: process.env.GITHUB_SHA,
      artifactId: process.env.REGISTRY_CANDIDATE_ARTIFACT_ID,
    };
    const checkpoint = await downloadCheckpoint(artifactClient, coordinates, {
      token: process.env.REGISTRY_ARTIFACT_TOKEN,
    });
    if (
      checkpoint.receipt.runId !== String(coordinates.runId) ||
      checkpoint.receipt.runAttempt !== coordinates.runAttempt
    ) {
      const origin = await verifyCheckpointProducer(artifactClient, {
        runId: checkpoint.receipt.runId,
        runAttempt: checkpoint.receipt.runAttempt,
        sourceSha: checkpoint.receipt.sourceSha,
      });
      if (origin.publicationDecision !== "prepared")
        throw Error("Original qualification receipt was not prepared.");
    }
    await report({
      phase: "artifact-verified",
      producerRunId: String(coordinates.runId),
      producerRunAttempt: coordinates.runAttempt,
      artifactId: checkpoint.artifactId,
      artifactDigest: checkpoint.artifactDigest,
      sourceSha: checkpoint.manifest.sourceSha,
      batchIdentity: checkpoint.manifest.batchIdentity,
    });
    result = await publishCheckpoint(runner, checkpoint, {
      onProgress: report,
    });
  } else throw Error("Unknown registry publication stage.");
  await report({ ...result, phase: "complete" });
  const message = `Registry publication: ${result.status}${result.count ? ` (${result.count} submission(s))` : ""}${result.prNumber ? ` — https://github.com/lapismd/plugin-registry/pull/${result.prNumber}` : ""}`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
} catch (error) {
  await report({
    status: "blocked",
    recovery:
      "Inspect the immutable branch/PR and originating workflow before re-dispatch; uncertain writes are never blindly retried.",
  });
  console.error(error.message);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Registry publication blocked: ${error.message.replace(/[\r\n]/g, " ")}\n`,
    );
  process.exitCode = 1;
}
