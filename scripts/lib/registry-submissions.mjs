import { mkdir, writeFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  listFiles,
  readJsonc,
  repoRoot,
  stableStringify,
} from "./registry.mjs";
import { validateRequest, requestFile } from "./registry-request.mjs";
import { compareVersions, isIndexedRelease } from "./registry-refresh.mjs";
import { GitHubClient } from "./github-client.mjs";
import {
  syncGitHubRelease,
  syncGitHubMetadata,
  validateDispatchPayload,
  validateMetadataDispatchPayload,
} from "../sync-github-release.mjs";

export function parseSubmission(value, file) {
  if (
    !value ||
    Object.keys(value).some(
      (key) => !["schemaVersion", "action", "client_payload"].includes(key),
    ) ||
    value.schemaVersion !== 1
  )
    throw new Error(`Invalid submission record: ${file}`);
  const request = validateRequest(value);
  if (requestFile(request) !== file)
    throw new Error(`Submission coordinates do not match path: ${file}`);
  return { file, request };
}

export async function loadSubmissions(root = repoRoot) {
  let files;
  try {
    files = await listFiles(new URL("submissions/", root));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return orderSubmissions(
    await Promise.all(
      files.map(async (file) => {
        const relative = path.relative(root.pathname, file.pathname);
        if (!relative.endsWith(".jsonc"))
          throw new Error(`Unexpected submission file: ${relative}`);
        return parseSubmission(await readJsonc(file), relative);
      }),
    ),
  );
}

export function orderSubmissions(records) {
  const paths = new Set();
  for (const record of records) {
    parseSubmission(record.request, record.file);
    if (paths.has(record.file))
      throw new Error(`Duplicate submission: ${record.file}`);
    paths.add(record.file);
  }
  return [...records].sort((a, b) => {
    const ap = a.request.client_payload,
      bp = b.request.client_payload;
    return (
      ap.plugin_id.localeCompare(bp.plugin_id) ||
      (ap.version && bp.version
        ? compareVersions(ap.version, bp.version)
        : ap.version
          ? -1
          : bp.version
            ? 1
            : recordKey(a).localeCompare(recordKey(b)))
    );
  });
}

export function recordKey(record) {
  return stableStringify(record.request, 0);
}

export async function writeSubmission(request, root = repoRoot) {
  const file = requestFile(request);
  const target = new URL(file, root);
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify(validateRequest(request), null, 2)}\n`,
  );
  return file;
}

export async function verifySubmission(
  record,
  { root = repoRoot, token = process.env.GITHUB_TOKEN, fetchImpl = fetch } = {},
) {
  parseSubmission(record.request, record.file);
  const temp = await mkdtemp(path.join(tmpdir(), "lapis-registry-submission-"));
  try {
    const entriesDir = pathToFileURL(`${temp}/entries/`);
    await mkdir(entriesDir);
    const p = record.request.client_payload;
    try {
      const existing = await readJsonc(
        new URL(`entries/official/${p.plugin_id}.jsonc`, root),
      );
      await writeFile(
        new URL(`${p.plugin_id}.jsonc`, entriesDir),
        JSON.stringify(existing),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return await replaySubmission(record, {
      entriesDir,
      token,
      fetchImpl,
      dryRun: true,
      env: {},
      trustRootPath: new URL("generated/v2/trust/root.json", root),
      contentDir: pathToFileURL(`${temp}/content/`),
      assetDir: pathToFileURL(`${temp}/assets/`),
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function replaySubmission(record, options = {}) {
  const request = parseSubmission(record.request, record.file).request;
  return request.action === "plugin_release"
    ? syncGitHubRelease({
        ...options,
        payload: validateDispatchPayload(request.client_payload),
      })
    : syncGitHubMetadata({
        ...options,
        payload: validateMetadataDispatchPayload(request.client_payload),
      });
}

export async function applySubmissions(
  records,
  {
    root = repoRoot,
    token = process.env.GITHUB_TOKEN,
    verify = verifySubmission,
    replay = replaySubmission,
    compareSources = async (repository, before, after) =>
      (
        await new GitHubClient(token).call(
          `/repos/${repository}/compare/${before}...${after}`,
        )
      ).status,
  } = {},
) {
  for (const record of orderSubmissions(records)) {
    const p = record.request.client_payload;
    let existing;
    try {
      existing = await readJsonc(
        new URL(`entries/official/${p.plugin_id}.jsonc`, root),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!p.version && existing?.source?.repository) {
      if (
        existing.source.repository !== p.repository ||
        existing.source.packageName !== p.package_name
      )
        throw new Error(
          `Queued ${p.plugin_id} metadata would change source ownership; reconcile manually.`,
        );
      const status =
        existing.source.sourceCommit === p.source_commit
          ? "identical"
          : await compareSources(
              p.repository,
              existing.source.sourceCommit,
              p.source_commit,
            );
      if (status === "behind") {
        await verify(record, { root, token });
        await rm(new URL(record.file, root));
        continue;
      }
      if (!["ahead", "identical"].includes(status))
        throw new Error(
          `Queued ${p.plugin_id} metadata has divergent source history; reconcile manually.`,
        );
    }
    if (p.version && isIndexedRelease(existing, p.version)) {
      const verified = await verify(record, { root, token });
      if (
        stableStringify(existing.versions[p.version].bundle, 0) !==
        stableStringify(verified.entry.versions[p.version].bundle, 0)
      )
        throw new Error(
          `Queued ${p.plugin_id}@${p.version} would replace an indexed artifact.`,
        );
    } else {
      if (
        p.version &&
        existing?.latestVersion &&
        compareVersions(p.version, existing.latestVersion) < 0
      )
        throw new Error(
          `Queued ${p.plugin_id}@${p.version} would downgrade the catalog; reconcile manually.`,
        );
      await replay(record, {
        token,
        entriesDir: new URL("entries/official/", root),
        trustRootPath: new URL("generated/v2/trust/root.json", root),
        contentDir: new URL("generated/v2/content/", root),
        assetDir: new URL("generated/v2/assets/", root),
      });
    }
    await rm(new URL(record.file, root));
  }
}
