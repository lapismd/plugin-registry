#!/usr/bin/env node
import { appendFile } from "node:fs/promises";

import { readProductionCommit } from "./lib/production-deployment.mjs";

let commit = "";
let reason = "";
try {
  commit = await readProductionCommit({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    projectName:
      process.env.CLOUDFLARE_PAGES_PROJECT ?? "lapis-plugin-registry",
  });
  console.log(`Production Pages currently serves commit ${commit}.`);
} catch (error) {
  reason = error instanceof Error ? error.message : String(error);
  console.warn(
    `Production commit unavailable; automatic deployment will be skipped: ${reason}`,
  );
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `deployed_commit=${commit}\nlookup_reason=${reason.replaceAll("\n", " ")}\n`,
  );
}
