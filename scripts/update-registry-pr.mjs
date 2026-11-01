#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GitHubClient } from "./lib/github-client.mjs";
import { validateRequest, requestBranch } from "./lib/registry-request.mjs";
import { refreshCandidate } from "./lib/registry-refresh.mjs";
import { createRegistryRunner } from "./lib/registry-runner.mjs";

const raw = JSON.parse(process.env.REGISTRY_TARGET);
const target = {
  request: validateRequest(raw.request ?? raw),
  prNumber: raw.prNumber,
  dryRun: process.env.REGISTRY_DRY_RUN === "true" || raw.dryRun === true,
};
const name = target.prNumber
  ? `PR #${target.prNumber}`
  : requestBranch(target.request);
const summaryName = target.prNumber
  ? `[${name}](https://github.com/lapismd/plugin-registry/pull/${target.prNumber})`
  : name;
try {
  const result = await refreshCandidate(
    target,
    createRegistryRunner(
      new GitHubClient(),
      target,
      fileURLToPath(new URL("../", import.meta.url)),
    ),
  );
  console.log(`${name}: ${result.status}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `- ${summaryName}: ${result.status}\n`,
    );
} catch (error) {
  console.error(`${name}: ${error.message}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `- ${summaryName}: **blocked** — ${error.message.replace(/[\r\n]/g, " ")}\n`,
    );
  process.exitCode = 1;
}
