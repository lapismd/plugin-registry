import { registryRepository } from "./registry-identity.mjs";
const isSha = (value) => /^[a-f0-9]{40}$/.test(value ?? "");
export const checkpointName = (runId, attempt) =>
  `registry-qualified-candidate-${runId}-${attempt}`;
export const checkpointLimit = 128 * 1024 * 1024;
export function assertReceiptRun(receipt, run) {
  if (
    String(run.id) !== receipt.runId ||
    run.run_attempt !== receipt.runAttempt ||
    run.head_sha !== receipt.sourceSha ||
    run.head_branch !== "main" ||
    run.repository?.full_name !== registryRepository ||
    run.path !== ".github/workflows/publish-registry-updates.yml" ||
    !["push", "workflow_dispatch"].includes(run.event)
  )
    throw Error(
      "Publication workflow provenance mismatch; reconcile manually.",
    );
  if (run.status === "completed" && run.conclusion !== "success")
    throw Error("Originating preparation attempt was not successful.");
  return run.status === "completed" && run.conclusion === "success";
}

export async function verifyCheckpointProducer(
  client,
  { runId, runAttempt, sourceSha },
) {
  if (
    !/^\d+$/.test(String(runId)) ||
    !Number.isSafeInteger(Number(runAttempt)) ||
    Number(runAttempt) < 1 ||
    !isSha(sourceSha)
  )
    throw Error("Invalid checkpoint producer coordinates.");
  const run = await client.call(
    `/repos/${registryRepository}/actions/runs/${runId}/attempts/${runAttempt}`,
  );
  const completed = assertReceiptRun(
    { runId: String(runId), runAttempt: Number(runAttempt), sourceSha },
    run,
  );
  if (!completed) throw Error("Checkpoint producer attempt is incomplete.");
  const jobs = [];
  for (let page = 1; page <= 100; page++) {
    const result = await client.call(
      `/repos/${registryRepository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100&page=${page}`,
    );
    if (!Array.isArray(result.jobs))
      throw Error("Incomplete producer job evidence.");
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) break;
    if (page === 100) throw Error("Truncated producer jobs.");
  }
  const prepares = jobs.filter((job) => job.name === "prepare");
  if (
    prepares.length !== 1 ||
    prepares[0].status !== "completed" ||
    prepares[0].conclusion !== "success"
  )
    throw Error("Candidate preparation was not qualified.");
  const decisions = (prepares[0].steps ?? []).filter(
    (step) =>
      step.name.startsWith("Publication decision: ") &&
      step.conclusion === "success",
  );
  if (
    decisions.length !== 1 ||
    ![
      "prepared",
      "verified",
      "empty",
      "unchanged",
      "qualification-pending",
    ].includes(decisions[0].name.slice(22))
  )
    throw Error("Missing successful preparation decision.");
  return { ...run, publicationDecision: decisions[0].name.slice(22) };
}
export async function resolveCheckpointArtifact(
  client,
  { runId, runAttempt, sourceSha, artifactId },
) {
  const producer = await verifyCheckpointProducer(client, {
    runId,
    runAttempt,
    sourceSha,
  });
  if (producer.publicationDecision !== "prepared")
    throw Error("Producer did not create a qualified candidate artifact.");
  if (artifactId && !/^\d+$/.test(String(artifactId)))
    throw Error("Invalid immutable artifact ID.");
  let artifact;
  if (artifactId)
    artifact = await client.call(
      `/repos/${registryRepository}/actions/artifacts/${artifactId}`,
    );
  else {
    const result = await client.call(
      `/repos/${registryRepository}/actions/runs/${runId}/artifacts?per_page=100`,
    );
    if (!Array.isArray(result.artifacts) || result.total_count > 100)
      throw Error("Incomplete checkpoint artifact coverage.");
    const matches = result.artifacts.filter(
      (item) => item.name === checkpointName(runId, runAttempt),
    );
    if (matches.length !== 1)
      throw Error("Qualified artifact missing or ambiguous; do not publish.");
    artifact = matches[0];
  }
  if (
    !Number.isSafeInteger(artifact.id) ||
    artifact.name !== checkpointName(runId, runAttempt) ||
    artifact.expired !== false ||
    artifact.workflow_run?.id !== Number(runId) ||
    artifact.workflow_run?.head_sha !== sourceSha ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "") ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes <= 0 ||
    artifact.size_in_bytes > checkpointLimit
  )
    throw Error("Artifact provenance/hash is unavailable or mismatched.");
  return artifact;
}
