#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { GitHubClient } from "./lib/github-client.mjs";
import { discoverTargets } from "./lib/registry-discovery.mjs";
import { parseRefreshInputs } from "./lib/registry-request.mjs";

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const inputs = parseRefreshInputs(
  event.name === "workflow_dispatch" || event.inputs ? event.inputs : {},
);
const trustRoot = JSON.parse(
  await readFile(
    new URL("../generated/v2/trust/root.json", import.meta.url),
    "utf8",
  ),
);
const result = await discoverTargets(new GitHubClient(), inputs, { trustRoot });
if (result.targets.length > 256)
  throw new Error("Too many refresh candidates for one workflow matrix.");
await appendFile(
  process.env.GITHUB_OUTPUT,
  `targets=${JSON.stringify(result.targets)}\nhas_targets=${result.targets.length > 0}\n`,
);
await appendFile(
  process.env.GITHUB_STEP_SUMMARY,
  `## Registry refresh discovery\n\n${result.targets.length} candidate(s).\n\n${result.report.map((r) => `- ${r.plugin ?? `[PR #${r.prNumber}](https://github.com/lapismd/plugin-registry/pull/${r.prNumber})`}: ${r.status}${r.version ? ` ${r.version}` : ""}${r.reason ? ` — ${r.reason.replace(/[\r\n]/g, " ")}` : ""}`).join("\n")}\n`,
);
if (result.report.some((r) => r.status === "blocked")) {
  // Let independent matrix jobs proceed, but retain a failing audit check.
  await appendFile(process.env.GITHUB_OUTPUT, "has_blocked=true\n");
}
