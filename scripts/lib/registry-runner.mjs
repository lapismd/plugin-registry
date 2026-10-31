import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  registryRepository,
  registryBot,
  requestBranch,
  requestFromPr,
  assertBotPr,
  assertChanges,
  assertSource,
  sameRequest,
  updateDescription,
} from "./registry-request.mjs";
import { LeaseConflict } from "./registry-refresh.mjs";
import {
  syncGitHubRelease,
  syncGitHubMetadata,
  validateDispatchPayload,
  validateMetadataDispatchPayload,
} from "../sync-github-release.mjs";

const execute = promisify(execFile);
export function createRegistryRunner(client, target, directory) {
  const request = target.request,
    payload = request.client_payload,
    branch = requestBranch(request);
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
        maxBuffer: 20 * 1024 * 1024,
      })
    ).stdout.trim();
  const entryPath = `entries/official/${payload.plugin_id}.jsonc`;
  const file = (ref) =>
    client.file(registryRepository, entryPath, ref, { missing: true });
  const sync = (options) =>
    request.action === "plugin_release"
      ? syncGitHubRelease({
          ...options,
          payload: validateDispatchPayload(payload),
        })
      : syncGitHubMetadata({
          ...options,
          payload: validateMetadataDispatchPayload(payload),
        });

  async function snapshot() {
    const mainSha = (
      await client.call(`/repos/${registryRepository}/commits/main`)
    ).sha;
    const matches = target.prNumber
      ? [
          await client.call(
            `/repos/${registryRepository}/pulls/${target.prNumber}`,
          ),
        ]
      : await client.list(
          `/repos/${registryRepository}/pulls?state=all&head=${encodeURIComponent(`lapismd:${branch}`)}`,
        );
    const pr = matches.find((p) => p.state === "open") ?? matches[0];
    if (
      pr &&
      pr.state !== "open" &&
      (target.prNumber || sameRequest(request, requestFromPr(pr)))
    )
      return { state: "closed" };
    const active = pr?.state === "open" ? pr : null;
    const ref = active
      ? null
      : await client.call(
          `/repos/${registryRepository}/git/ref/heads/${encodeURIComponent(branch)}`,
          { missing: true },
        );
    const headSha = active?.head.sha ?? ref?.object.sha ?? "";
    const entry = await file(mainSha);
    let baseEntry = entry,
      originalRequest = request;
    if (headSha) {
      if (active) {
        assertBotPr(active);
        originalRequest = requestFromPr(active);
      }
      const comparison = await client.call(
        `/repos/${registryRepository}/compare/${mainSha}...${headSha}`,
      );
      const commits = active
        ? await client.list(
            `/repos/${registryRepository}/pulls/${active.number}/commits`,
          )
        : comparison.commits;
      const files = active
        ? await client.list(
            `/repos/${registryRepository}/pulls/${active.number}/files`,
          )
        : comparison.files;
      if (
        !active &&
        (comparison.total_commits !== commits.length || files.length >= 300)
      )
        throw new Error("Orphan branch comparison is incomplete.");
      assertChanges(
        originalRequest,
        commits,
        files.flatMap((f) =>
          f.previous_filename
            ? [f.filename, f.previous_filename]
            : [f.filename],
        ),
      );
      assertSource(originalRequest, await file(headSha));
      baseEntry = await file(comparison.merge_base_commit.sha);
      if (!target.prNumber && !sameRequest(request, originalRequest)) {
        if (
          request.action !== "plugin_metadata" ||
          originalRequest.action !== "plugin_metadata" ||
          payload.repository !== originalRequest.client_payload.repository
        )
          throw new Error(
            "A different verified request already owns this branch.",
          );
        const ancestry = await client.call(
          `/repos/${payload.repository}/compare/${originalRequest.client_payload.source_commit}...${payload.source_commit}`,
        );
        if (ancestry.status !== "ahead")
          throw new Error(
            "Metadata request is older or divergent; manual reconciliation required.",
          );
      }
    }
    return {
      state: "open",
      mainSha,
      headSha,
      entry,
      baseEntry,
      request: originalRequest,
      pr: active,
    };
  }

  async function verify(snapshot) {
    // Public verification is also used by dry runs. Mirror media only in disposable storage.
    const temp = await mkdtemp(path.join(tmpdir(), "lapis-registry-verify-"));
    try {
      const entries = path.join(temp, "entries");
      await mkdir(entries);
      if (snapshot.entry)
        await writeFile(
          path.join(entries, `${payload.plugin_id}.jsonc`),
          JSON.stringify(snapshot.entry),
        );
      const root = await client.file(
        registryRepository,
        "generated/v2/trust/root.json",
        snapshot.mainSha,
      );
      const rootPath = path.join(temp, "root.json");
      await writeFile(rootPath, JSON.stringify(root));
      await sync({
        entriesDir: pathToFileURL(`${entries}/`),
        trustRootPath: pathToFileURL(rootPath),
        contentDir: pathToFileURL(`${temp}/content/`),
        assetDir: pathToFileURL(`${temp}/assets/`),
        env: {},
        token,
        dryRun: true,
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  async function build(snapshot) {
    if (process.env.GITHUB_ACTIONS !== "true")
      throw new Error(
        "Branch materialization is restricted to disposable GitHub Actions checkouts. Use dry_run locally.",
      );
    await git(
      "fetch",
      "origin",
      snapshot.mainSha,
      ...(snapshot.headSha ? [snapshot.headSha] : []),
    );
    await git("reset", "--hard", snapshot.mainSha);
    // Dependencies must follow the latest trusted main even if main advanced since job setup.
    await execute("pnpm", ["install", "--frozen-lockfile"], {
      cwd: directory,
      maxBuffer: 20 * 1024 * 1024,
    });
    const result = await sync({ token });
    const commands = [
      "fmt",
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
    ];
    for (const command of commands) {
      console.log(`Running pnpm ${command}`);
      const output = await execute("pnpm", [command], {
        cwd: directory,
        maxBuffer: 30 * 1024 * 1024,
      });
      console.log(output.stdout);
    }
    await git("add", "--", entryPath, "generated");
    const paths = (await git("diff", "--cached", "--name-only"))
      .split("\n")
      .filter(Boolean);
    assertChanges(request, [], paths);
    const tree = await git("write-tree");
    let unchanged = false;
    if (snapshot.headSha)
      unchanged =
        tree === (await git("rev-parse", `${snapshot.headSha}^{tree}`)) &&
        (await git("merge-base", snapshot.mainSha, snapshot.headSha)) ===
          snapshot.mainSha;
    if (!unchanged) {
      const user = await client.call(
        `/users/${encodeURIComponent(registryBot)}`,
      );
      const identity = {
        ...authEnv,
        GIT_AUTHOR_NAME: registryBot,
        GIT_COMMITTER_NAME: registryBot,
        GIT_AUTHOR_EMAIL: `${user.id}+${registryBot}@users.noreply.github.com`,
        GIT_COMMITTER_EMAIL: `${user.id}+${registryBot}@users.noreply.github.com`,
      };
      await execute(
        "git",
        [
          "commit",
          "-m",
          `chore(registry): index ${payload.plugin_id} ${payload.version ?? "metadata"}`,
        ],
        { cwd: directory, env: identity },
      );
    }
    return {
      sha: unchanged ? snapshot.headSha : await git("rev-parse", "HEAD"),
      entry: result.entry,
      unchanged,
    };
  }

  async function publish(candidate, expected) {
    const latest = await snapshot();
    if (
      latest.state !== "open" ||
      latest.mainSha !== expected.mainSha ||
      latest.headSha !== expected.headSha ||
      (target.prNumber && !sameRequest(latest.request, request))
    )
      throw new LeaseConflict("PR changed before publication.");
    if (!candidate.unchanged) {
      try {
        await git(
          "push",
          `--force-with-lease=refs/heads/${branch}:${expected.headSha}`,
          "origin",
          `${candidate.sha}:refs/heads/${branch}`,
        );
      } catch {
        throw new LeaseConflict(
          "Branch lease changed or publication failed; retry.",
        );
      }
    }
    const body = updateDescription(
      latest.pr?.body ?? "",
      request,
      candidate.entry,
    );
    if (latest.pr) {
      // A maintainer may have edited notes during the push. Preserve the latest prose.
      const current = await client.call(
        `/repos/${registryRepository}/pulls/${latest.pr.number}`,
      );
      if (
        current.state !== "open" ||
        current.head.sha !== candidate.sha ||
        !sameRequest(requestFromPr(current), latest.request)
      )
        throw new LeaseConflict("PR changed before description update.");
      await client.call(
        `/repos/${registryRepository}/pulls/${current.number}`,
        {
          method: "PATCH",
          body: {
            body: updateDescription(current.body, request, candidate.entry),
          },
        },
      );
    } else {
      await client.call(`/repos/${registryRepository}/pulls`, {
        method: "POST",
        body: {
          base: "main",
          head: branch,
          title: `Index ${payload.plugin_id} ${payload.version ?? "metadata"}`,
          body,
        },
      });
    }
  }
  return { snapshot, verify, build, publish };
}
