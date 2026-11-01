import {
  verifyReleaseBundle,
  verifyChecksumFile,
} from "../sync-github-release.mjs";
import { sha256 } from "./registry.mjs";
import {
  assertBotPr,
  requestFromPr,
  assertChanges,
  requestBranch,
  validateRequest,
  registryRepository,
  registryBot,
  requestFile,
  sameRequest,
} from "./registry-request.mjs";
import { compareVersions, isIndexedRelease } from "./registry-refresh.mjs";
import { parseSubmission } from "./registry-submissions.mjs";

export async function discoverTargets(client, inputs, { trustRoot } = {}) {
  const main = await client.call(`/repos/${registryRepository}/commits/main`);
  const pulls = inputs.prNumber
    ? [
        await client.call(
          `/repos/${registryRepository}/pulls/${inputs.prNumber}`,
        ),
      ]
    : await client.list(`/repos/${registryRepository}/pulls?state=open`);
  const targets = [],
    report = [];
  for (const pr of pulls) {
    if (
      !inputs.prNumber &&
      (pr.user?.login !== registryBot ||
        !pr.head.ref.startsWith("automation/plugin-"))
    )
      continue;
    try {
      assertBotPr(pr);
      const request = requestFromPr(pr);
      if (
        !inputs.prNumber &&
        pr.body?.includes("<!-- lapis-registry-managed:start -->")
      ) {
        {
          const comparison = await client.call(
            `/repos/${registryRepository}/compare/${main.sha}...${pr.head.sha}`,
          );
          const [commits, files] = await Promise.all([
            client.list(
              `/repos/${registryRepository}/pulls/${pr.number}/commits`,
            ),
            client.list(
              `/repos/${registryRepository}/pulls/${pr.number}/files`,
            ),
          ]);
          assertChanges(
            request,
            commits,
            files.flatMap((file) =>
              file.previous_filename
                ? [file.filename, file.previous_filename]
                : [file.filename],
            ),
          );
          const queued = await client.file(
            registryRepository,
            requestFile(request),
            pr.head.sha,
            { missing: true },
          );
          if (
            comparison.merge_base_commit?.sha === main.sha &&
            queued &&
            sameRequest(
              parseSubmission(queued, requestFile(request)).request,
              request,
            ) &&
            files.every((file) => file.filename === requestFile(request)) &&
            pr.body.includes("Merging this one-file submission queues")
          ) {
            report.push({ prNumber: pr.number, status: "current" });
            continue;
          }
        }
      }
      targets.push({ request, prNumber: pr.number, dryRun: inputs.dryRun });
    } catch (error) {
      report.push({
        prNumber: pr.number,
        status: "blocked",
        reason: error.message,
      });
    }
  }
  if (inputs.recoverMissing) {
    const sourceRepo = "lapismd/lapis-plugins";
    const sourceSha = (await client.call(`/repos/${sourceRepo}/commits/main`))
      .sha;
    const tree = await client.call(
      `/repos/${sourceRepo}/git/trees/${sourceSha}?recursive=1`,
    );
    if (tree.truncated) throw new Error("Source inventory is truncated.");
    const releases = await client.list(`/repos/${sourceRepo}/releases`);
    for (const item of tree.tree.filter((x) =>
      /^packages\/[^/]+\/package\.json$/.test(x.path),
    )) {
      const directory = item.path.split("/")[1];
      const packageJson = await client.file(sourceRepo, item.path, sourceSha);
      if (packageJson.private) {
        report.push({ plugin: directory, status: "parked" });
        continue;
      }
      try {
        const manifest = await client.file(
          sourceRepo,
          `packages/${directory}/manifest.json`,
          sourceSha,
        );
        const candidates = releases
          .filter(
            (r) =>
              !r.draft &&
              !r.prerelease &&
              r.tag_name.startsWith(`${directory}@`) &&
              /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
                r.tag_name.slice(directory.length + 1),
              ),
          )
          .sort((a, b) =>
            compareVersions(
              b.tag_name.split("@").at(-1),
              a.tag_name.split("@").at(-1),
            ),
          );
        if (!candidates.length) {
          report.push({ plugin: manifest.id, status: "unreleased" });
          continue;
        }
        const release = candidates[0],
          version = release.tag_name.split("@").at(-1);
        const entry = await client.file(
          registryRepository,
          `entries/official/${manifest.id}.jsonc`,
          main.sha,
          { missing: true },
        );
        if (isIndexedRelease(entry, version)) {
          report.push({ plugin: manifest.id, status: "indexed", version });
          continue;
        }
        if (
          entry?.latestVersion &&
          compareVersions(entry.latestVersion, version) > 0
        ) {
          report.push({
            plugin: manifest.id,
            status: "newer-indexed",
            version,
          });
          continue;
        }
        const branch = `automation/plugin-${manifest.id}-${version}`;
        if (
          targets.some((t) => requestBranch(t.request) === branch) ||
          pulls.some((p) => p.head.ref === branch)
        ) {
          report.push({ plugin: manifest.id, status: "pending", version });
          continue;
        }
        const request = await requestFromPublishedRelease(
          client,
          {
            repository: sourceRepo,
            packageName: packageJson.name,
            pluginId: manifest.id,
            version,
            release,
          },
          trustRoot,
        );
        const queued = await client.file(
          registryRepository,
          requestFile(request),
          main.sha,
          { missing: true },
        );
        if (queued) {
          if (
            !sameRequest(
              parseSubmission(queued, requestFile(request)).request,
              request,
            )
          )
            throw new Error("A competing release already owns the queue path.");
          report.push({ plugin: manifest.id, version, status: "queued" });
          continue;
        }
        targets.push({ request, dryRun: inputs.dryRun });
        report.push({
          plugin: manifest.id,
          version,
          status: entry ? "stale" : "missing",
          sourceCommit: request.client_payload.source_commit,
        });
      } catch (error) {
        report.push({
          plugin: directory,
          status: "blocked",
          reason: error.message,
        });
      }
    }
  }
  return { targets, report };
}

export async function requestFromPublishedRelease(client, coordinates, root) {
  const { repository, packageName, pluginId, version, release } = coordinates;
  const assetName = `${pluginId}-${version}.lapis-plugin`;
  const sourceCommit = await client.tagCommit(repository, release.tag_name);
  const request = validateRequest({
    action: "plugin_release",
    client_payload: {
      repository,
      package_name: packageName,
      plugin_id: pluginId,
      version,
      release_tag: release.tag_name,
      asset_name: assetName,
      source_commit: sourceCommit,
    },
  });
  const download = async (name) => {
    const asset = release.assets.find((a) => a.name === name);
    if (!asset) throw new Error(`Missing published asset: ${name}`);
    const response = await client.fetch(asset.browser_download_url);
    if (!response.ok)
      throw new Error(`Published asset HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== asset.size)
      throw new Error("Published asset size mismatch.");
    return bytes;
  };
  const [bytes, checksum] = await Promise.all([
    download(assetName),
    download(`${assetName}.sha256`),
  ]);
  verifyChecksumFile(checksum, assetName, sha256(bytes));
  if (!root)
    throw new Error("Recovery requires the committed release trust root.");
  const trust = {
    root,
    keys: new Map(
      root.keys.map((k) => [k.keyId, { ...k, source: "trust-root" }]),
    ),
    releaseRoles: new Set(root.roles.release),
  };
  verifyReleaseBundle({
    payload: { repository, packageName, pluginId, version, sourceCommit },
    bundleBytes: bytes,
    trust,
  });
  return request;
}
