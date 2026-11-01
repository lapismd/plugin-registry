import { registryBot, registryRepository } from "./registry-request.mjs";
import { orderSubmissions, recordKey } from "./registry-submissions.mjs";
import { stableStringify } from "./registry.mjs";
import { LeaseConflict } from "./registry-refresh.mjs";

export const publicationBranch = "automation/publish-registry";
const start = "<!-- lapis-registry-publication:start -->";
const end = "<!-- lapis-registry-publication:end -->";

export function publicationRecords(body = "") {
  const matches = [
    ...body.matchAll(
      /<!-- lapis-registry-publication-record\n([\s\S]*?)\n-->/g,
    ),
  ];
  if (matches.length !== 1)
    throw new Error("Publication PR has no unique managed record.");
  const record = JSON.parse(matches[0][1]);
  if (record.schemaVersion !== 1 || !Array.isArray(record.submissions))
    throw new Error("Invalid publication record.");
  return orderSubmissions(record.submissions);
}

export function publicationIdentity(records) {
  return stableStringify(
    orderSubmissions(records).map((record) => ({
      file: record.file,
      request: JSON.parse(recordKey(record)),
    })),
    0,
  );
}

export function assertPublicationPr(pr, commits, files) {
  if (
    pr.user?.login !== registryBot ||
    pr.head?.repo?.full_name !== registryRepository ||
    pr.head.ref !== publicationBranch ||
    pr.base?.ref !== "main"
  )
    throw new Error("Publication branch is not owned by the registry bot.");
  if (
    commits.some(
      (commit) =>
        commit.author?.login !== registryBot ||
        commit.committer?.login !== registryBot,
    )
  )
    throw new Error(
      "Publication PR contains human or unattributed commits; reconcile manually.",
    );
  const records = publicationRecords(pr.body);
  const entries = new Set(
    records.map(
      (record) =>
        `entries/official/${record.request.client_payload.plugin_id}.jsonc`,
    ),
  );
  const queue = new Set(records.map((record) => record.file));
  for (const file of files) {
    for (const filename of [file.filename, file.previous_filename].filter(
      Boolean,
    )) {
      if (
        filename.startsWith("generated/v2/") ||
        filename === "generated/download-targets.mjs" ||
        entries.has(filename)
      ) {
        continue;
      }
      if (queue.has(filename) && file.status === "removed") continue;
      throw new Error(`Unexpected publication change: ${filename}`);
    }
  }
  return records;
}

export function publicationDescription(body, records, sourceRef = "main") {
  const managed = [
    start,
    "This PR publishes verified plugin submissions that maintainers have merged into the registry queue. It updates the curated entries, mirrors their declared images, regenerates the catalog and signs its metadata together.",
    ...orderSubmissions(records).map(({ request, file }) => {
      const p = request.client_payload;
      return `- **${p.plugin_id} ${p.version ?? "metadata"}** — [queued request](https://github.com/${registryRepository}/blob/${sourceRef}/${file}) · [verified source](https://github.com/${p.repository}/commit/${p.source_commit})`;
    }),
    "Merge this PR to publish this batch through the existing production deployment gate. New submissions are collected into this same open PR automatically.",
    `<!-- lapis-registry-publication-record\n${JSON.stringify({ schemaVersion: 1, submissions: orderSubmissions(records) }, null, 2)}\n-->`,
    end,
  ].join("\n\n");
  if (!body) return managed;
  if (
    body.split(start).length !== 2 ||
    body.split(end).length !== 2 ||
    body.indexOf(start) > body.indexOf(end)
  )
    throw new Error("Malformed managed publication description.");
  return (
    body.slice(0, body.indexOf(start)) +
    managed +
    body.slice(body.indexOf(end) + end.length)
  );
}

export async function publishQueuedSubmissions(
  adapter,
  { dryRun = false } = {},
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const before = await adapter.snapshot();
      if (!before.records.length) return { status: "empty" };
      await adapter.verify(before);
      if (dryRun) return { status: "verified", count: before.records.length };
      const candidate = await adapter.build(before);
      const latest = await adapter.snapshot();
      if (
        before.mainSha !== latest.mainSha ||
        before.headSha !== latest.headSha ||
        before.pr?.number !== latest.pr?.number ||
        publicationIdentity(before.records) !==
          publicationIdentity(latest.records)
      ) {
        console.warn(
          `Publication state moved during attempt ${attempt + 1}/3; rebuilding from the new snapshot.`,
        );
        continue;
      }
      const pr = await adapter.publish(candidate, latest);
      return {
        status: "updated",
        count: before.records.length,
        prNumber: pr.number,
      };
    } catch (error) {
      if (!(error instanceof LeaseConflict)) throw error;
      console.warn(`Publication retry ${attempt + 1}/3: ${error.message}`);
    }
  }
  throw new Error(
    "Registry publication kept changing; retry the publication workflow.",
  );
}
