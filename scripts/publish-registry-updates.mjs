#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GitHubClient } from "./lib/github-client.mjs";
import { createPublicationRunner } from "./lib/registry-publication-runner.mjs";
import { publishQueuedSubmissions } from "./lib/registry-publication.mjs";

try {
  const result = await publishQueuedSubmissions(
    createPublicationRunner(
      new GitHubClient(),
      fileURLToPath(new URL("../", import.meta.url)),
    ),
    { dryRun: process.env.REGISTRY_DRY_RUN === "true" },
  );
  const message = `Registry publication: ${result.status}${result.count ? ` (${result.count} submission(s))` : ""}${result.prNumber ? ` — https://github.com/lapismd/plugin-registry/pull/${result.prNumber}` : ""}`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
} catch (error) {
  console.error(error.message);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Registry publication blocked: ${error.message.replace(/[\r\n]/g, " ")}\n`,
    );
  process.exitCode = 1;
}
