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
} from "./registry-publication.mjs";
import { LeaseConflict } from "./registry-refresh.mjs";

const execute = promisify(execFile);
export function createPublicationRunner(client, directory) {
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
    const pr = pulls.find((p) => p.state === "open");
    const previous = pr ?? pulls[0];
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
        await verifySubmission(record, { root, token });
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
    await applySubmissions(snapshot.records, { root, token });
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
    await execute(
      "git",
      ["commit", "-m", "chore(registry): publish queued plugin updates"],
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
  async function publish(candidate, expected) {
    const latest = await snapshot();
    if (
      latest.mainSha !== expected.mainSha ||
      latest.headSha !== expected.headSha ||
      latest.pr?.number !== expected.pr?.number
    )
      throw new LeaseConflict("Publication changed before push.");
    try {
      await git(
        "push",
        `--force-with-lease=refs/heads/${publicationBranch}:${expected.headSha}`,
        "origin",
        `${candidate.sha}:refs/heads/${publicationBranch}`,
      );
    } catch {
      throw new LeaseConflict(
        "Publication branch lease changed or push failed.",
      );
    }
    if (latest.pr) {
      const current = await client.call(
        `/repos/${registryRepository}/pulls/${latest.pr.number}`,
      );
      if (
        current.state !== "open" ||
        current.head.sha !== candidate.sha ||
        publicationIdentity(publicationRecords(current.body)) !==
          publicationIdentity(publicationRecords(latest.pr.body))
      )
        throw new LeaseConflict(
          "Publication PR changed before description update.",
        );
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
  return { snapshot, verify, build, publish };
}
