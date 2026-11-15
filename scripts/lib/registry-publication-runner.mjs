import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  encodeCheckpoint,
  assertPublicChanges,
  verifyCheckpointProducer,
} from "./publication-checkpoint.mjs";
import { GitHubClient } from "./github-client.mjs";
import { createSubmissionFetchCache } from "./submission-fetch-cache.mjs";
import {
  buildReceipt,
  readReceipt,
  receiptMessage,
  reusableReceipt,
  assertReceiptRun,
  batchIdentity,
} from "./publication-receipt.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  registryBot,
  registryRepository,
  sameRequest,
} from "./registry-request.mjs";
import {
  parseSubmission,
  orderSubmissions,
  applySubmissions,
  verifySubmission,
} from "./registry-submissions.mjs";
import {
  publicationBranch,
  assertPublicationPr,
  publicationDescription,
  publicationIdentity,
  publicationRecords,
  pushQualifiedCandidate,
} from "./registry-publication.mjs";
import { LeaseConflict } from "./registry-refresh.mjs";
import { stableStringify } from "./registry.mjs";
import { waitForPrHead } from "./registry-head.mjs";

const executeCommand = promisify(execFile);
export function createPublicationRunner(client, directory, options = {}) {
  const execute = options.execute ?? executeCommand;
  const root = pathToFileURL(`${directory}/`);
  const token = process.env.GITHUB_TOKEN;
  const authEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };
  const git = async (...args) =>
    (
      await execute("git", args, {
        cwd: directory,
        env: authEnv,
        maxBuffer: 30 * 1024 * 1024,
      })
    ).stdout.trim();
  let runtime, cachedInput, submissionFetch;
  const executionRuntime = async () =>
    (runtime ??= await (options.runtime?.() ??
      (async () => {
        const sourceSha = await git("rev-parse", "HEAD");
        const pkg = JSON.parse(
          await readFile(new URL("package.json", root), "utf8"),
        );
        const version = (
          await execute("pnpm", ["--version"], { cwd: directory })
        ).stdout.trim();
        if (pkg.packageManager !== `pnpm@${version}`)
          throw Error("Publication requires its exact pinned package manager.");
        return {
          sourceSha,
          node: process.versions.node,
          packageManager: pkg.packageManager,
        };
      })()));
  async function reuseArtifact(snapshot) {
    const checkpoint = await options.reuseCheckpoint?.(snapshot);
    if (!checkpoint) return null;
    const candidate = await installCheckpoint(checkpoint, snapshot);
    return { ...candidate, descriptionCurrent: false };
  }
  async function reuse(snapshot) {
    if (!snapshot.headSha) return reuseArtifact(snapshot);
    const commit = await client.call(
      `/repos/${registryRepository}/commits/${snapshot.headSha}`,
    );
    const receipt = readReceipt(commit);
    if (!receipt) return reuseArtifact(snapshot);
    if (
      commit.author?.login !== registryBot ||
      commit.committer?.login !== registryBot
    )
      throw Error(
        "Unattributed publication receipt; preserve branch for repair.",
      );
    if (!reusableReceipt(receipt, snapshot, await executionRuntime()))
      return reuseArtifact(snapshot);
    const readRun =
      options.readRun ??
      ((path) => new GitHubClient("", client.fetch).call(path));
    const run = await readRun(
      `/repos/${registryRepository}/actions/runs/${receipt.runId}/attempts/${receipt.runAttempt}`,
    );
    const completed = assertReceiptRun(receipt, run);
    if (completed && !options.readRun)
      await verifyCheckpointProducer(new GitHubClient("", client.fetch), {
        runId: receipt.runId,
        runAttempt: receipt.runAttempt,
        sourceSha: receipt.sourceSha,
      });
    return {
      sha: snapshot.headSha,
      pending: !completed,
      descriptionCurrent: snapshot.pr
        ? publicationIdentity(publicationRecords(snapshot.pr.body)) ===
          publicationIdentity(snapshot.records)
        : false,
    };
  }
  async function command(name, args) {
    console.log(`Running ${name} ${args.join(" ")}`);
    try {
      const result = await execute(name, args, {
        cwd: directory,
        maxBuffer: 30 * 1024 * 1024,
      });
      console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
    } catch (error) {
      console.error(error.stdout ?? "");
      console.error(error.stderr ?? "");
      throw error;
    }
  }
  async function snapshot() {
    const mainSha = (
      await client.call(`/repos/${registryRepository}/commits/main`)
    ).sha;
    const tree = await client.call(
      `/repos/${registryRepository}/git/trees/${mainSha}?recursive=1`,
    );
    if (tree.truncated)
      throw new Error("Registry queue inventory is truncated.");
    const records = orderSubmissions(
      await Promise.all(
        tree.tree
          .filter(
            (item) =>
              item.type === "blob" && item.path.startsWith("submissions/"),
          )
          .map(async (item) =>
            parseSubmission(
              await client.file(registryRepository, item.path, mainSha),
              item.path,
            ),
          ),
      ),
    );
    if (!records.length) return { mainSha, headSha: "", records, pr: null };
    const pulls = await client.list(
      `/repos/${registryRepository}/pulls?state=all&head=${encodeURIComponent(`lapismd:${publicationBranch}`)}`,
    );
    const listed = pulls.find((p) => p.state === "open");
    const detail = listed
      ? await client.call(`/repos/${registryRepository}/pulls/${listed.number}`)
      : null;
    const pr = detail?.state === "open" ? detail : undefined;
    const previous = detail ?? pulls[0];
    if (previous) {
      const [commits, files] = await Promise.all([
        client.list(
          `/repos/${registryRepository}/pulls/${previous.number}/commits`,
        ),
        client.list(
          `/repos/${registryRepository}/pulls/${previous.number}/files`,
        ),
      ]);
      const previousRecords = assertPublicationPr(previous, commits, files);
      for (const record of previousRecords) {
        const queued = records.find((item) => item.file === record.file);
        if (queued && !sameRequest(queued.request, record.request))
          throw new Error(
            "Publication request identity changed; reconcile the queue or PR manually.",
          );
      }
      if (pr) {
        const comparison = await client.call(
          `/repos/${registryRepository}/compare/${mainSha}...${pr.head.sha}`,
        );
        const base = comparison.merge_base_commit?.sha;
        if (!base)
          throw new Error(
            "Publication comparison is incomplete; reconcile manually.",
          );
        const plugins = new Set(
          previousRecords
            .filter((record) =>
              records.some((queued) => queued.file === record.file),
            )
            .map((record) => record.request.client_payload.plugin_id),
        );
        for (const id of plugins) {
          const file = `entries/official/${id}.jsonc`;
          const [current, original] = await Promise.all([
            client.file(registryRepository, file, mainSha, { missing: true }),
            client.file(registryRepository, file, base, { missing: true }),
          ]);
          if (stableStringify(current, 0) !== stableStringify(original, 0))
            throw new Error(
              `${id}: curated entry changed on main while publication PR https://github.com/${registryRepository}/pull/${pr.number} was open; reconcile manually.`,
            );
        }
      }
      if (!pr && !previous.merged_at && records.length)
        throw new Error(
          `Publication PR #${previous.number} was closed without merging. Reopen it or reconcile its queued requests manually.`,
        );
    }
    const ref = await client.call(
      `/repos/${registryRepository}/git/ref/heads/${encodeURIComponent(publicationBranch)}`,
      { missing: true },
    );
    if (pr && pr.head.sha !== ref?.object.sha)
      throw new LeaseConflict("Publication branch changed during discovery.");
    if (ref && (!previous || previous.head.sha !== ref.object.sha)) {
      const comparison = await client.call(
        `/repos/${registryRepository}/compare/${mainSha}...${ref.object.sha}`,
      );
      if (
        !comparison.total_commits ||
        comparison.total_commits !== comparison.commits?.length ||
        comparison.files?.length >= 300
      )
        throw new Error(
          "Unattributed or incomplete publication branch requires manual reconciliation.",
        );
      assertPublicationPr(
        {
          user: { login: registryBot },
          head: {
            ref: publicationBranch,
            repo: { full_name: registryRepository },
          },
          base: { ref: "main" },
          body: publicationDescription("", records, mainSha),
        },
        comparison.commits,
        comparison.files,
      );
    }
    return { mainSha, headSha: ref?.object.sha ?? "", records, pr };
  }
  async function verify(snapshot) {
    // Verify against the captured trusted main, never against a PR checkout.
    if (process.env.GITHUB_ACTIONS !== "true")
      throw new Error("Use the read-only submissions verifier locally.");
    const identity = await executionRuntime();
    if (
      identity.sourceSha !== snapshot.mainSha ||
      process.env.GITHUB_SHA !== snapshot.mainSha ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_REPOSITORY !== registryRepository ||
      process.env.GITHUB_WORKFLOW_REF !==
        `${registryRepository}/.github/workflows/publish-registry-updates.yml@refs/heads/main`
    )
      throw new LeaseConflict(
        "Trusted execution source moved; start a fresh main workflow.",
      );
    const input = batchIdentity(snapshot.mainSha, snapshot.records);
    if (cachedInput !== input) {
      cachedInput = input;
      submissionFetch = createSubmissionFetchCache(options.fetchImpl ?? fetch);
    }
    await git(
      "fetch",
      "origin",
      snapshot.mainSha,
      ...(snapshot.headSha ? [snapshot.headSha] : []),
    );
    await git("reset", "--hard", snapshot.mainSha);
    await command("pnpm", ["install", "--frozen-lockfile"]);
    for (const record of snapshot.records) {
      try {
        await verifySubmission(record, {
          root,
          token,
          fetchImpl: submissionFetch,
        });
      } catch (error) {
        throw new Error(
          `${record.file} (https://github.com/${registryRepository}/blob/${snapshot.mainSha}/${record.file}): ${error.message}`,
        );
      }
    }
  }
  async function build(snapshot) {
    if (process.env.GITHUB_ACTIONS !== "true")
      throw new Error(
        "Publication is restricted to disposable GitHub Actions checkouts.",
      );
    await applySubmissions(snapshot.records, {
      root,
      token,
      fetchImpl: submissionFetch,
    });
    for (const task of [
      "fmt",
      "registry:submissions:validate",
      "registry:validate",
      "registry:validate:remote",
      "registry:generate",
      "registry:sign",
      "registry:verify-signatures",
      "stats:validate",
      "site:check",
      "site:build",
      "test",
      "check:format",
    ])
      await command("pnpm", [task]);
    await git("add", "--", "entries", "generated", "submissions");
    const paths = (
      await git("diff", "--cached", "--name-status", "--no-renames")
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, filename] = line.split("\t");
        return { filename, status: status === "D" ? "removed" : "modified" };
      });
    assertPublicationPr(
      {
        user: { login: registryBot },
        head: {
          ref: publicationBranch,
          repo: { full_name: registryRepository },
        },
        base: { ref: "main" },
        body: publicationDescription("", snapshot.records, snapshot.mainSha),
      },
      [],
      paths,
    );
    const user = await client.call(`/users/${encodeURIComponent(registryBot)}`);
    const email = `${user.id}+${registryBot}@users.noreply.github.com`;
    const receipt = buildReceipt({
      ...(await executionRuntime()),
      sourceSha: snapshot.mainSha,
      treeSha: await git("write-tree"),
      records: snapshot.records,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    });
    await execute(
      "git",
      ["-c", "commit.gpgsign=false", "commit", "-m", receiptMessage(receipt)],
      {
        cwd: directory,
        env: {
          ...authEnv,
          GIT_AUTHOR_NAME: registryBot,
          GIT_COMMITTER_NAME: registryBot,
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_EMAIL: email,
        },
      },
    );
    return { sha: await git("rev-parse", "HEAD") };
  }
  const rawGit = async (...args) =>
    (
      await execute("git", args, {
        cwd: directory,
        env: authEnv,
        encoding: "buffer",
        maxBuffer: 128 * 1024 * 1024,
      })
    ).stdout;
  async function changes(sourceSha, candidateSha, cached = false, indexPath) {
    const output = async (...args) =>
      indexPath
        ? (
            await execute("git", args, {
              cwd: directory,
              env: { ...authEnv, GIT_INDEX_FILE: indexPath },
              encoding: "buffer",
              maxBuffer: 128 * 1024 * 1024,
            })
          ).stdout
        : rawGit(...args);
    const raw = (
      await output(
        "diff",
        ...(cached ? ["--cached"] : []),
        "--name-status",
        "--no-renames",
        "-z",
        sourceSha,
        ...(cached ? [] : [candidateSha]),
      )
    )
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    const files = [];
    for (let i = 0; i < raw.length; i += 2) {
      if (!["A", "M", "D"].includes(raw[i]) || !raw[i + 1])
        throw Error("Unexpected candidate change type.");
      const filename = raw[i + 1],
        status = raw[i] === "D" ? "removed" : "modified";
      const line =
        status === "removed"
          ? ""
          : await output(
              ...(cached
                ? ["ls-files", "--stage", "--", filename]
                : ["ls-tree", candidateSha, "--", filename]),
            );
      files.push({
        filename,
        status,
        ...(line ? { mode: line.toString("utf8").trim().split(" ")[0] } : {}),
      });
    }
    return files;
  }
  async function checkpoint(candidate, snapshot) {
    if (
      process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_SHA !== snapshot.mainSha ||
      (await executionRuntime()).sourceSha !== snapshot.mainSha
    )
      throw Error("Checkpoint preparation requires the exact trusted source.");
    try {
      await git("cat-file", "-e", `${candidate.sha}^{commit}`);
    } catch {
      await git("fetch", "origin", candidate.sha);
    }
    const commitObject = await rawGit("cat-file", "commit", candidate.sha);
    const patch = await rawGit(
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      snapshot.mainSha,
      candidate.sha,
      "--",
    );
    const result = encodeCheckpoint({
      snapshot,
      candidateSha: candidate.sha,
      commitObject,
      patch,
      files: await changes(snapshot.mainSha, candidate.sha),
      producer: {
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        sourceSha: snapshot.mainSha,
      },
    });
    await mkdir(new URL("tmp/qualified-publication/", root), {
      recursive: true,
    });
    await writeFile(
      new URL("tmp/qualified-publication/candidate.zip", root),
      result.bytes,
    );
    return { digest: result.digest };
  }
  async function installCheckpoint(checkpoint, snapshot) {
    if (
      process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_SHA !== snapshot.mainSha ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_REPOSITORY !== registryRepository ||
      process.env.GITHUB_WORKFLOW_REF !==
        `${registryRepository}/.github/workflows/${process.env.REGISTRY_PUBLICATION_STAGE === "prepare" ? "publish-registry-updates" : "write-registry-publication"}.yml@refs/heads/main`
    )
      throw Error("Artifact import requires its exact trusted main workflow.");
    const identity = await executionRuntime();
    if (
      identity.sourceSha !== snapshot.mainSha ||
      !reusableReceipt(checkpoint.receipt, snapshot, identity)
    )
      throw Error("Qualified artifact toolchain or source identity changed.");
    assertPublicChanges(snapshot.records, checkpoint.manifest.files);
    await git("diff", "--quiet");
    const patchPath = new URL("tmp/qualified-publication/restore.patch", root);
    const commitPath = new URL(
      "tmp/qualified-publication/restore.commit",
      root,
    );
    await mkdir(new URL("./", patchPath), { recursive: true });
    await writeFile(patchPath, checkpoint.patch);
    await writeFile(commitPath, checkpoint.commitObject);
    const numstat = (
      await rawGit("apply", "--numstat", "-z", patchPath.pathname)
    )
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((line) => line.split("\t").slice(2).join("\t"));
    if (
      numstat.sort().join("\0") !==
      checkpoint.manifest.files
        .map((file) => file.filename)
        .sort()
        .join("\0")
    )
      throw Error("Patch paths differ from the public manifest.");
    const summary = (
      await rawGit("apply", "--summary", patchPath.pathname)
    ).toString("utf8");
    if (
      [
        ...summary.matchAll(
          /(?:create mode|delete mode|mode change)\s+([0-9]{6})(?:\s*=>\s*([0-9]{6}))?/g,
        ),
      ].some((match) =>
        match
          .slice(1)
          .filter(Boolean)
          .some((mode) => mode !== "100644"),
      )
    )
      throw Error("Non-regular or executable candidate mode.");
    const indexPath = new URL("tmp/qualified-publication/restore.index", root)
      .pathname;
    const indexGit = async (...args) =>
      (
        await execute("git", args, {
          cwd: directory,
          env: { ...authEnv, GIT_INDEX_FILE: indexPath },
          maxBuffer: 128 * 1024 * 1024,
        })
      ).stdout.trim();
    await indexGit("read-tree", snapshot.mainSha);
    await indexGit(
      "apply",
      "--cached",
      "--binary",
      "--whitespace=nowarn",
      patchPath.pathname,
    );
    const actual = await changes(snapshot.mainSha, "", true, indexPath);
    assertPublicChanges(snapshot.records, actual);
    if (
      stableStringify(actual, 0) !==
        stableStringify(checkpoint.manifest.files, 0) ||
      (await indexGit("write-tree")) !== checkpoint.receipt.treeSha
    )
      throw Error(
        "Restored artifact tree/path mutation; no publication attempted.",
      );
    const sha = await git(
      "hash-object",
      "-t",
      "commit",
      "-w",
      commitPath.pathname,
    );
    if (sha !== checkpoint.manifest.candidateSha)
      throw Error("Restored commit hash mismatch.");
    return { sha };
  }
  async function publish(candidate, expected) {
    if (
      process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_SHA !== expected.mainSha ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_REPOSITORY !== registryRepository ||
      process.env.GITHUB_WORKFLOW_REF !==
        `${registryRepository}/.github/workflows/write-registry-publication.yml@refs/heads/main` ||
      (await executionRuntime()).sourceSha !== expected.mainSha
    )
      throw Error(
        "Publication writes require the exact trusted writer workflow.",
      );
    const latest = await snapshot();
    if (
      latest.mainSha !== expected.mainSha ||
      latest.headSha !== expected.headSha ||
      latest.pr?.number !== expected.pr?.number
    )
      throw new LeaseConflict("Publication changed before push.");
    await pushQualifiedCandidate(candidate.sha, expected.headSha, {
      push: () =>
        git(
          "push",
          `--force-with-lease=refs/heads/${publicationBranch}:${expected.headSha}`,
          "origin",
          `${candidate.sha}:refs/heads/${publicationBranch}`,
        ),
      readHead: async () =>
        (
          await client.call(
            `/repos/${registryRepository}/git/ref/heads/${encodeURIComponent(publicationBranch)}`,
            { missing: true },
          )
        )?.object.sha,
    });
    if (latest.pr) {
      const current = await waitForPrHead(client, latest.pr.number, {
        expectedHead: candidate.sha,
        previousHead: expected.headSha,
        isExpected: (current) =>
          publicationIdentity(publicationRecords(current.body)) ===
          publicationIdentity(publicationRecords(latest.pr.body)),
      });
      return client.call(
        `/repos/${registryRepository}/pulls/${current.number}`,
        {
          method: "PATCH",
          body: {
            body: publicationDescription(
              current.body,
              latest.records,
              latest.mainSha,
            ),
          },
        },
      );
    }
    return client.call(`/repos/${registryRepository}/pulls`, {
      method: "POST",
      body: {
        base: "main",
        head: publicationBranch,
        title: "Publish registry updates",
        body: publicationDescription("", latest.records, latest.mainSha),
      },
    });
  }
  const metrics = () => {
    const stats = submissionFetch?.metrics();
    return stats
      ? {
          fetchHits: stats.hits,
          fetchRequests: stats.misses,
          retainedBytes: stats.retainedBytes,
        }
      : {};
  };
  return {
    snapshot,
    reuse,
    verify,
    build,
    checkpoint,
    installCheckpoint,
    publish,
    metrics,
  };
}
