import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "jsonc-parser";
import {
  validateDispatchPayload,
  validateMetadataDispatchPayload,
  syncGitHubRelease,
  syncGitHubMetadata,
  buildUpdatedEntry,
} from "../sync-github-release.mjs";
import { buildRegistry, validateEntryRules } from "../lib/registry.mjs";
import { handleDownloadRequest } from "../../functions/download/[plugin]/[version].js";

const payload = {
  repository: "lapismd/lapis-plugins",
  package_name: "@lapis-notes/ai",
  plugin_id: "ai",
  version: "0.1.15",
  release_tag: "ai@0.1.15",
  asset_name: "ai-0.1.15.lapis-plugin",
  source_commit: "a".repeat(40),
};
const metadata = (({ version, release_tag, asset_name, ...rest }) => rest)(
  payload,
);
const normalized = {
  repository: payload.repository,
  packageName: payload.package_name,
  pluginId: payload.plugin_id,
  version: payload.version,
  releaseTag: payload.release_tag,
  assetName: payload.asset_name,
  sourceCommit: payload.source_commit,
};

test("shared AI source is disabled while historical versions remain indexed", async () => {
  const entry = parse(
    await readFile(
      new URL("../../entries/official/ai.jsonc", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(entry.status, "disabled");
  assert.ok(Object.keys(entry.versions).length > 0);
  const registry = buildRegistry([entry]);
  assert.equal(registry.index.plugins[0].status, "disabled");
  for (const [version, release] of Object.entries(entry.versions)) {
    const { downloadUrl, ...bundle } =
      registry.details.ai.versions[version].bundle;
    assert.deepEqual(
      { ...registry.details.ai.versions[version], bundle },
      release,
    );
    assert.ok(downloadUrl);
  }
  assert.ok(
    validateEntryRules([{ ...entry, status: "active" }]).some((error) =>
      /retired/i.test(error),
    ),
  );
});

test("stale AI release and metadata dispatches cannot reactivate distribution", () => {
  assert.throws(() => validateDispatchPayload(payload), /retired/i);
  assert.throws(() => validateMetadataDispatchPayload(metadata), /retired/i);
});

test("direct sync entrypoints reject retired provenance before IO", async () => {
  let calls = 0;
  const options = {
    payload: normalized,
    fetchImpl: async () => {
      calls++;
      throw new Error("unexpected network");
    },
    entriesDir: new URL("file:///unreachable-retirement-test/"),
  };
  await assert.rejects(syncGitHubRelease(options), /retired/i);
  await assert.rejects(syncGitHubMetadata(options), /retired/i);
  assert.equal(calls, 0);
  assert.throws(() => buildUpdatedEntry({ payload: normalized }), /retired/i);
});

test("retirement is scoped to shared AI provenance, not every plugin named ai", () => {
  const thirdParty = {
    ...payload,
    repository: "example/plugins",
    package_name: "@example/ai",
  };
  assert.equal(validateDispatchPayload(thirdParty).pluginId, "ai");
  assert.equal(
    validateMetadataDispatchPayload({
      ...metadata,
      repository: "example/plugins",
      package_name: "@example/ai",
    }).pluginId,
    "ai",
  );
});

test("saved download links for every retired AI version return authoritative Gone before archive fetch", async () => {
  const entry = parse(
    await readFile(
      new URL("../../entries/official/ai.jsonc", import.meta.url),
      "utf8",
    ),
  );
  const { downloadTargets } = buildRegistry([entry]);
  let fetches = 0;
  for (const version of Object.keys(entry.versions)) {
    for (const method of ["GET", "HEAD"]) {
      const response = await handleDownloadRequest(
        {
          request: new Request(
            `https://registry.example.test/download/ai/${version}?action=install`,
            { method },
          ),
          params: { plugin: "ai", version },
          waitUntil() {
            throw new Error("must not record a rejected install");
          },
        },
        downloadTargets,
        async () => {
          fetches++;
          throw new Error("must not fetch a retired archive");
        },
      );
      assert.equal(response.status, 410, `${method} ai@${version}`);
    }
  }
  assert.equal(fetches, 0);
});
