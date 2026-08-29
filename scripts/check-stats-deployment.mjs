#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

import {
  isStatsOnlyDeployment,
  readProductionCommit,
} from "./lib/production-deployment.mjs";

const githubOutput = process.env.GITHUB_OUTPUT;
let deploy = false;
let reason = "production deployment could not be verified";
try {
  const capturedCommit = process.env.DEPLOYED_PRODUCTION_COMMIT;
  if (capturedCommit === "") {
    throw new Error("the pre-aggregation production lookup did not succeed");
  }
  const deployedCommit =
    capturedCommit ??
    (await readProductionCommit({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      projectName:
        process.env.CLOUDFLARE_PAGES_PROJECT ?? "lapis-plugin-registry",
    }));
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", `${deployedCommit}..HEAD`],
    { encoding: "utf8" },
  );
  if (diff.status !== 0) {
    reason = "the deployed production commit is not available in this checkout";
  } else {
    const files = diff.stdout.split("\n").filter(Boolean);
    deploy = isStatsOnlyDeployment(files);
    reason = deploy
      ? "all commits since the production deployment change stats only"
      : "non-stats changes are waiting behind the manual release gate";
  }
} catch (error) {
  reason = error instanceof Error ? error.message : String(error);
}

console.log(`${deploy ? "Deploying" : "Skipping deployment"}: ${reason}.`);
if (githubOutput) {
  await appendFile(
    githubOutput,
    `deploy=${deploy}\nreason=${reason.replaceAll("\n", " ")}\n`,
  );
}
