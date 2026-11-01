import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../", import.meta.url);

test("submission workers keep registry signing out of one-file plugin PRs", async () => {
  const worker = await readFile(
    new URL(".github/workflows/materialize-registry-pr.yml", repoRoot),
    "utf8",
  );
  const runner = await readFile(
    new URL("scripts/lib/registry-runner.mjs", repoRoot),
    "utf8",
  );
  assert.doesNotMatch(worker, /LAPIS_REGISTRY_PRIVATE_KEY/);
  assert.doesNotMatch(runner, /\"registry:sign\"/);
  assert.match(runner, /writeSubmission/);
});

test("production deployment follows validated main merges after the V2 cutover approval", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/publish.yml", repoRoot),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /\n\s+push:/);
  assert.match(workflow, /STATIC_REGISTRY_V2_DEPLOY_APPROVED == 'true'/);
  assert.match(workflow, /inputs\.approval == 'REGISTRY_DEPLOY_APPROVED'/);
  assert.match(workflow, /environment: registry-production/);
  assert.match(workflow, /pnpm exec wrangler pages deploy dist/);
  assert.match(workflow, /git diff --exit-code generated/);
  assert.doesNotMatch(workflow, /pnpm registry:sign/);
  assert.doesNotMatch(workflow, /npx --yes wrangler/);
  assert.doesNotMatch(workflow, /visual|baseline/i);
});

test("release dispatch delegates to the shared verified, leased publication pipeline", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/sync-plugin-release.yml", repoRoot),
    "utf8",
  );
  const worker = await readFile(
    new URL(".github/workflows/materialize-registry-pr.yml", repoRoot),
    "utf8",
  );
  const runner = await readFile(
    new URL("scripts/lib/registry-runner.mjs", repoRoot),
    "utf8",
  );
  const publication = await readFile(
    new URL("scripts/lib/registry-publication-runner.mjs", repoRoot),
    "utf8",
  );
  assert.match(
    workflow,
    /uses: \.\/\.github\/workflows\/materialize-registry-pr\.yml/,
  );
  assert.match(workflow, /types: \[plugin_release, plugin_metadata\]/);
  assert.match(worker, /ref: main/);
  assert.match(worker, /fetch-depth: 0/);
  assert.match(worker, /persist-credentials: false/);
  assert.match(worker, /actions\/create-github-app-token@v3/);
  assert.match(worker, /REGISTRY_TARGET: \$\{\{ inputs\.target \}\}/);
  assert.match(worker, /node scripts\/update-registry-pr\.mjs/);
  for (const command of [
    "registry:validate",
    "registry:generate",
    "registry:sign",
    "registry:verify-signatures",
    "registry:validate:remote",
    "stats:validate",
    "site:check",
    "site:build",
    "test",
    "check:format",
  ])
    assert.ok(publication.includes(`"${command}"`));
  assert.ok(
    publication.indexOf('"registry:generate"') <
      publication.indexOf('"registry:sign"'),
  );
  assert.ok(
    runner.indexOf('"registry:validate:remote"') < runner.indexOf('"push"'),
  );
  assert.match(runner, /--force-with-lease=refs\/heads\//);
  assert.match(runner, /snapshot\(\)/);
  assert.doesNotMatch(worker, /visual|baseline/i);
});

test("refresh is manual and automatic with bounded independent workers and a read-only discovery job", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/refresh-registry-prs.yml", repoRoot),
    "utf8",
  );
  assert.match(workflow, /push:[\s\S]*branches: \[main\]/);
  assert.match(workflow, /workflows: \[Sync plugin release\]/);
  assert.match(workflow, /workflow_dispatch:/);
  for (const input of ["pr_number", "dry_run", "recover_missing_releases"])
    assert.ok(workflow.includes(`${input}:`));
  assert.match(workflow, /max-parallel: 3/);
  assert.match(
    workflow,
    /group: registry-pr-refresh-\$\{\{ github.event_name == 'workflow_dispatch' && github.run_id \|\| 'automatic' \}\}/,
  );
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /permission-contents: read/);
  assert.match(workflow, /permission-pull-requests: read/);
  assert.match(workflow, /ref: main/);
  assert.match(
    workflow,
    /uses: \.\/\.github\/workflows\/materialize-registry-pr\.yml/,
  );
  assert.doesNotMatch(workflow, /pull_request_target|wrangler pages deploy/);
});

test("pull requests run strict remote bundle validation", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/checks.yml", repoRoot),
    "utf8",
  );
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /pnpm registry:validate:remote/);
  assert.match(workflow, /pnpm registry:submissions:verify/);
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
  assert.match(
    workflow,
    /client-id: \$\{\{ secrets\.LAPIS_REGISTRY_APP_CLIENT_ID \}\}/,
  );
  assert.doesNotMatch(workflow, /app-id:|LAPIS_REGISTRY_APP_ID/);
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
  assert.match(workflow, /ref: \$\{\{ inputs\.source_ref \}\}/);
  assert.match(workflow, /base: \$\{\{ inputs\.source_ref \}\}/);
  assert.match(
    workflow,
    /client-id: \$\{\{ secrets\.LAPIS_REGISTRY_APP_CLIENT_ID \}\}/,
  );
  assert.doesNotMatch(workflow, /app-id:|LAPIS_REGISTRY_APP_ID/);
  assert.ok(generation >= 0);
  assert.ok(signing > generation);
  assert.ok(pullRequest > signing);
  assert.doesNotMatch(workflow, /wrangler pages deploy/);
});

test("every GitHub workflow uses Node 24 builds and Node 24 action runtimes", async () => {
  const workflowNames = [
    "checks.yml",
    "download-stats.yml",
    "publish.yml",
    "sign-registry-metadata.yml",
    "materialize-registry-pr.yml",
    "refresh-registry-prs.yml",
    "publish-registry-updates.yml",
  ];
  for (const name of workflowNames) {
    const workflow = await readFile(
      new URL(`.github/workflows/${name}`, repoRoot),
      "utf8",
    );
    assert.match(workflow, /actions\/checkout@v7/);
    assert.match(workflow, /pnpm\/action-setup@v6/);
    assert.match(workflow, /actions\/setup-node@v7/);
    assert.match(workflow, /node-version:\s*["']?24/);
    assert.doesNotMatch(workflow, /@v4|node-version:\s*["']?(20|22)/);
  }
});

test("one publication workflow consumes approved submissions without deploying them directly", async () => {
  const workflow = await readFile(
    new URL(".github/workflows/publish-registry-updates.yml", repoRoot),
    "utf8",
  );
  const deploy = await readFile(
    new URL(".github/workflows/publish.yml", repoRoot),
    "utf8",
  );
  assert.match(workflow, /push:[\s\S]*branches: \[main\]/);
  assert.match(
    workflow,
    /group: registry-publication-\$\{\{ github.event_name == 'workflow_dispatch' && github.run_id \|\| 'automatic' \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /dry_run:/);
  assert.match(workflow, /node scripts\/publish-registry-updates.mjs/);
  assert.match(workflow, /LAPIS_REGISTRY_PRIVATE_KEY_PEM_B64/);
  assert.doesNotMatch(workflow, /wrangler|pull_request_target/);
  assert.match(deploy, /paths-ignore: \[submissions\/\*\*\]/);
});
