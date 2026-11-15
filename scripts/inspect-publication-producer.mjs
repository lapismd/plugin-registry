#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import {
  verifyCheckpointProducer,
  resolveCheckpointArtifact,
} from "./lib/publication-producer.mjs";
import { registryRepository } from "./lib/registry-identity.mjs";
const token = process.env.GITHUB_TOKEN;
const client = {
  call: async (path) => {
    if (!path.startsWith(`/repos/${registryRepository}/actions/`))
      throw Error("Unexpected producer API scope.");
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Error(`Producer evidence unavailable (${response.status}).`);
    return response.json();
  },
};
if (
  process.env.GITHUB_REF !== "refs/heads/main" ||
  process.env.GITHUB_REPOSITORY !== registryRepository
)
  throw Error("Producer inspection requires trusted main.");
const coordinates = {
  runId: process.env.REGISTRY_PRODUCER_RUN_ID,
  runAttempt: Number(process.env.REGISTRY_PRODUCER_RUN_ATTEMPT),
  sourceSha: process.env.GITHUB_SHA,
};
const producer = await verifyCheckpointProducer(client, coordinates);
const artifact =
  producer.publicationDecision === "prepared"
    ? await resolveCheckpointArtifact(client, coordinates)
    : null;
await appendFile(
  process.env.GITHUB_OUTPUT,
  `has_candidate=${!!artifact}\ndecision=${producer.publicationDecision}\nartifact_id=${artifact?.id ?? ""}\n`,
);
await appendFile(
  process.env.GITHUB_STEP_SUMMARY,
  `Registry preparation ${coordinates.runId}/${coordinates.runAttempt}: ${producer.publicationDecision}; qualified artifact ${artifact?.id ?? "not required"}.\n`,
);
