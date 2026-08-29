import assert from "node:assert/strict";
import test from "node:test";

import {
  isStatsOnlyDeployment,
  readProductionCommit,
} from "../lib/production-deployment.mjs";

test("reads the currently deployed production commit from Cloudflare Pages", async () => {
  let requested;
  const commit = await readProductionCommit({
    accountId: "account",
    apiToken: "pages-token",
    fetchImpl: async (url, init) => {
      requested = { url: url.toString(), init };
      return Response.json({
        success: true,
        result: [
          {
            deployment_trigger: {
              metadata: { commit_hash: "0123456789abcdef" },
            },
          },
        ],
      });
    },
  });

  assert.equal(commit, "0123456789abcdef");
  assert.match(requested.url, /env=production/);
  assert.equal(requested.init.headers.authorization, "Bearer pages-token");
});

test("production commit lookup fails closed on malformed API responses", async () => {
  await assert.rejects(
    readProductionCommit({
      accountId: "account",
      apiToken: "token",
      fetchImpl: async () => Response.json({ success: true, result: [] }),
    }),
    /did not return a production commit/,
  );
});

test("automatic deployment permits only stats paths", () => {
  assert.equal(
    isStatsOnlyDeployment([
      "stats/daily/2026-02-01.json",
      "stats/summary.json",
    ]),
    true,
  );
  assert.equal(
    isStatsOnlyDeployment(["stats/summary.json", "src/pages/index.astro"]),
    false,
  );
  assert.equal(isStatsOnlyDeployment([]), false);
  assert.equal(isStatsOnlyDeployment(["stats/../wrangler.jsonc"]), false);
});
