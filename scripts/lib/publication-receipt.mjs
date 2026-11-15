import { createHash } from "node:crypto";
import { publicationIdentity } from "./registry-publication.mjs";
import { registryRepository } from "./registry-request.mjs";

const marker = "Lapis-Registry-Publication: ";
const sha = (value) => /^[a-f0-9]{40}$/.test(value ?? "");
export const batchIdentity = (sourceSha, records) =>
  createHash("sha256")
    .update(JSON.stringify([sourceSha, publicationIdentity(records)]))
    .digest("hex");
export function buildReceipt({
  sourceSha,
  treeSha,
  records,
  node,
  packageManager,
  runId,
  runAttempt,
}) {
  const receipt = {
    schemaVersion: 1,
    qualification: "registry-publication-v1",
    sourceSha,
    treeSha,
    batchIdentity: batchIdentity(sourceSha, records),
    node,
    packageManager,
    runId: String(runId),
    runAttempt: Number(runAttempt),
  };
  validateReceipt(receipt);
  return receipt;
}
function validateReceipt(receipt) {
  if (
    !receipt ||
    Object.keys(receipt).sort().join() !==
      [
        "schemaVersion",
        "qualification",
        "sourceSha",
        "treeSha",
        "batchIdentity",
        "node",
        "packageManager",
        "runId",
        "runAttempt",
      ]
        .sort()
        .join() ||
    receipt.schemaVersion !== 1 ||
    receipt.qualification !== "registry-publication-v1" ||
    !sha(receipt.sourceSha) ||
    !sha(receipt.treeSha) ||
    !/^[a-f0-9]{64}$/.test(receipt.batchIdentity ?? "") ||
    !/^\d+\.\d+\.\d+$/.test(receipt.node ?? "") ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(receipt.packageManager ?? "") ||
    !/^\d+$/.test(receipt.runId ?? "") ||
    !Number.isSafeInteger(receipt.runAttempt) ||
    receipt.runAttempt < 1
  )
    throw Error("Invalid publication build receipt; reconcile manually.");
  return receipt;
}
export const receiptMessage = (receipt) =>
  `chore(registry): publish queued plugin updates\n\n${marker}${JSON.stringify(validateReceipt(receipt))}`;
export function readReceipt(commit) {
  const matches =
    commit.commit?.message
      ?.split("\n")
      .filter((line) => line.startsWith(marker)) ?? [];
  if (!matches.length) return null;
  if (matches.length !== 1)
    throw Error("Ambiguous publication build receipt; reconcile manually.");
  const receipt = validateReceipt(JSON.parse(matches[0].slice(marker.length)));
  if (
    commit.commit.tree?.sha !== receipt.treeSha ||
    commit.parents?.length !== 1 ||
    commit.parents[0].sha !== receipt.sourceSha
  )
    throw Error(
      "Publication receipt does not match immutable tree/source ancestry.",
    );
  return receipt;
}
export function reusableReceipt(receipt, snapshot, runtime) {
  return (
    receipt.sourceSha === snapshot.mainSha &&
    receipt.batchIdentity ===
      batchIdentity(snapshot.mainSha, snapshot.records) &&
    receipt.node === runtime.node &&
    receipt.packageManager === runtime.packageManager &&
    runtime.sourceSha === snapshot.mainSha
  );
}
export { assertReceiptRun } from "./publication-producer.mjs";
