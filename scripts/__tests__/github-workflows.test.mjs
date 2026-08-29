import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../", import.meta.url);

test("production deployment stays manual and explicitly approved", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/publish.yml", repoRoot),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /FIRST_REGISTRY_RELEASE_APPROVED == 'true'/);
  assert.match(workflow, /inputs\.approval == 'REGISTRY_DEPLOY_APPROVED'/);
  assert.match(workflow, /environment: registry-production/);
  assert.match(workflow, /pnpm exec wrangler pages deploy dist/);
  assert.match(workflow, /git diff --exit-code generated/);
  assert.doesNotMatch(workflow, /pnpm registry:sign/);
  assert.doesNotMatch(workflow, /npx --yes wrangler/);
  assert.doesNotMatch(workflow, /visual|baseline/i);
});

test("release dispatch verifies assets before opening an idempotent PR", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/sync-plugin-release.yml", repoRoot),
    "utf8",
  );
  const syncIndex = workflow.indexOf("registry:sync:github");
  const remoteValidationIndex = workflow.indexOf("registry:validate:remote");
  const pullRequestIndex = workflow.indexOf("peter-evans/create-pull-request");
  assert.ok(syncIndex >= 0);
  assert.ok(remoteValidationIndex > syncIndex);
  assert.ok(pullRequestIndex > remoteValidationIndex);
  assert.match(workflow, /automation\/plugin-\$\{\{/);
  assert.match(workflow, /actions\/create-github-app-token@v3/);
  assert.match(workflow, /types: \[plugin_release, plugin_metadata\]/);
  assert.match(workflow, /version \|\| 'metadata'/);
  assert.doesNotMatch(workflow, /visual|baseline/i);
});

test("pull requests run strict remote bundle validation", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/checks.yml", repoRoot),
    "utf8",
  );
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /pnpm registry:validate:remote/);
  assert.doesNotMatch(workflow, /visual|baseline/i);
});

test("download statistics use delayed immutable snapshots and a stats-only deployment guard", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/download-stats.yml", repoRoot),
    "utf8",
  );
  const productionLookup = workflow.indexOf("Read deployed production commit");
  const aggregation = workflow.indexOf("Aggregate missing immutable UTC days");
  const commit = workflow.indexOf("Commit immutable snapshots");
  const guard = workflow.indexOf("Check automatic deployment boundary");
  const deploy = workflow.indexOf("Deploy statistics-only update");
  assert.match(workflow, /cron: "17 4 \* \* \*"/);
  assert.match(workflow, /DOWNLOAD_STATS_AUTOMATION_APPROVED == 'true'/);
  assert.match(workflow, /CLOUDFLARE_ANALYTICS_API_TOKEN/);
  assert.match(workflow, /actions\/create-github-app-token@v3/);
  assert.match(workflow, /git push origin HEAD:main/);
  assert.ok(productionLookup >= 0);
  assert.ok(aggregation > productionLookup);
  assert.ok(commit > aggregation);
  assert.ok(guard > commit);
  assert.ok(deploy > guard);
});

test("registry metadata signing is reviewable and separate from deployment", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/sign-registry-metadata.yml", repoRoot),
    "utf8",
  );
  const generation = workflow.indexOf("pnpm registry:generate");
  const signing = workflow.indexOf("pnpm registry:sign");
  const pullRequest = workflow.indexOf("peter-evans/create-pull-request");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /inputs\.approval == 'REGISTRY_SIGN_APPROVED'/);
  assert.match(workflow, /environment: registry-production/);
  assert.ok(generation >= 0);
  assert.ok(signing > generation);
  assert.ok(pullRequest > signing);
  assert.doesNotMatch(workflow, /wrangler pages deploy/);
});
