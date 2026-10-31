import {
  validateDispatchPayload,
  validateMetadataDispatchPayload,
} from "../sync-github-release.mjs";
import { stableStringify } from "./registry.mjs";

export const registryRepository = "lapismd/plugin-registry";
export const registryBot = "lapismd-registry-automation[bot]";
const start = "<!-- lapis-registry-managed:start -->";
const end = "<!-- lapis-registry-managed:end -->";
const recordStart = "<!-- lapis-registry-request\n";

export function validateRequest(input) {
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1)
    throw new Error("Unsupported registry request schema.");
  if (input.action === "plugin_release")
    validateDispatchPayload(input.client_payload);
  else if (input.action === "plugin_metadata")
    validateMetadataDispatchPayload(input.client_payload);
  else throw new Error("Unsupported registry request action.");
  return {
    schemaVersion: 1,
    action: input.action,
    client_payload: { ...input.client_payload },
  };
}

export function requestBranch(request) {
  const p = request.client_payload;
  return `automation/plugin-${p.plugin_id}-${p.version ?? "metadata"}`;
}

export function requestFromPr(pr) {
  const body = pr.body ?? "";
  const records = [
    ...body.matchAll(/<!-- lapis-registry-request\n([\s\S]*?)\n-->/g),
  ];
  if (body.includes("<!-- lapis-registry-request") && records.length !== 1)
    throw new Error("Malformed registry request record.");
  let request;
  if (records.length) request = validateRequest(JSON.parse(records[0][1]));
  else {
    const packageName = body.match(
      /Automated, verified registry update for `([^`]+)`\./,
    )?.[1];
    const source = body.match(/^- Source: `([^`]+)@([a-f0-9]{40})`$/m);
    const releaseTag = body.match(/^- Release: `([^`]+)`$/m)?.[1];
    const asset = body.match(/^- Asset: `([^`]+)`$/m)?.[1];
    if (!packageName || !source || !releaseTag || !asset)
      throw new Error("Cannot recover legacy registry request.");
    const pluginId = pr.head.ref.match(
      /^automation\/plugin-(.+)-(?:metadata|\d+\.\d+\.\d+)$/,
    )?.[1];
    const metadata = releaseTag === "metadata-only" && asset === "unchanged";
    request = validateRequest({
      action: metadata ? "plugin_metadata" : "plugin_release",
      client_payload: {
        repository: source[1],
        package_name: packageName,
        plugin_id: pluginId,
        source_commit: source[2],
        ...(!metadata
          ? {
              release_tag: releaseTag,
              asset_name: asset,
              version: releaseTag.split("@").at(-1),
            }
          : {}),
      },
    });
  }
  if (requestBranch(request) !== pr.head.ref)
    throw new Error("Registry request does not match PR branch.");
  return request;
}

export function sameRequest(a, b) {
  return (
    stableStringify(validateRequest(a), 0) ===
    stableStringify(validateRequest(b), 0)
  );
}

export function assertBotPr(pr) {
  if (pr.user?.login !== registryBot)
    throw new Error("PR is not owned by the registry bot.");
  if (
    pr.head?.repo?.full_name !== registryRepository ||
    pr.base?.ref !== "main"
  )
    throw new Error("PR must target main in the same registry repository.");
  if (!pr.head.ref.startsWith("automation/plugin-"))
    throw new Error("PR is not an automation plugin branch.");
}

export function assertChanges(request, commits, paths) {
  if (
    commits.some(
      (c) =>
        c.author?.login !== registryBot ||
        ![registryBot, "github-actions[bot]"].includes(c.committer?.login),
    )
  )
    throw new Error(
      "PR contains human or unattributed commits; manual reconciliation required.",
    );
  const id = request.client_payload.plugin_id;
  const allowed = new Set([
    `entries/official/${id}.jsonc`,
    "generated/download-targets.mjs",
    "generated/v2/index.json",
    "generated/v2/index.sig",
    `generated/v2/plugins/${id}.json`,
    `generated/v2/plugins/${id}.sig`,
    "generated/v2/trust/root.json",
  ]);
  for (const path of paths)
    if (!allowed.has(path) && !path.startsWith(`generated/v2/assets/${id}/`))
      throw new Error(`Unexpected PR file: ${path}`);
}

export function assertSource(request, entry) {
  const p = request.client_payload,
    source = entry?.source;
  if (
    source?.repository !== p.repository ||
    source?.packageName !== p.package_name ||
    source?.sourceCommit !== p.source_commit ||
    (p.version &&
      (!entry.versions?.[p.version] || source.releaseTag !== p.release_tag))
  )
    throw new Error("PR entry source coordinates do not match request.");
}

export function parseRefreshInputs(inputs = {}) {
  const number = String(inputs.pr_number ?? "").trim();
  if (
    number &&
    (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number)))
  )
    throw new Error("PR number must be a positive integer.");
  const boolean = (value) => {
    if (value === undefined || value === false || value === "false")
      return false;
    if (value === true || value === "true") return true;
    throw new Error("Expected a boolean input.");
  };
  const result = {
    prNumber: number ? Number(number) : undefined,
    dryRun: boolean(inputs.dry_run),
    recoverMissing: boolean(inputs.recover_missing_releases),
  };
  if (result.prNumber && result.recoverMissing)
    throw new Error(
      "Cannot combine a PR number with missing-release recovery.",
    );
  return result;
}

function markdown(value) {
  return String(value ?? "")
    .replace(/[\\`*_[\]<>]/g, "\\$&")
    .replace(/[\r\n]/g, " ");
}

function imageMarkdown(image, request) {
  if (!image?.images?.preview) return null;
  const p = request.client_payload;
  const prefix = `https://raw.githubusercontent.com/${p.repository}/${p.source_commit}/`;
  const checkedUrl = (asset) => {
    const url = asset?.sourceUrl;
    if (
      typeof url !== "string" ||
      !url.startsWith(prefix) ||
      /[\s<>]/.test(url) ||
      new URL(url).href !== url ||
      new URL(url).search ||
      new URL(url).hash
    )
      throw new Error(
        "PR images must use validated, commit-pinned source URLs.",
      );
    return url;
  };
  const preview = checkedUrl(image.images.preview);
  const full = image.images.full ? checkedUrl(image.images.full) : preview;
  return {
    key: image.images.preview.sha256 ?? preview,
    text: `[![${markdown(image.alt)}](<${preview}>)](<${full}>)`,
  };
}

export function renderDescription(request, entry) {
  const p = request.client_payload;
  const seen = new Set();
  const take = (image) => {
    const value = imageMarkdown(image, request);
    if (!value || seen.has(value.key)) return null;
    seen.add(value.key);
    return value.text;
  };
  const banner = take(entry.media?.banner);
  const gallery = [entry.media?.overview, ...(entry.gallery ?? [])]
    .map(take)
    .filter(Boolean);
  return [
    start,
    `Automated, verified registry update for \`${p.package_name}\`.`,
    `- Source: \`${p.repository}@${p.source_commit}\`\n- Release: \`${p.release_tag ?? "metadata-only"}\`\n- Asset: \`${p.asset_name ?? "unchanged"}\``,
    request.action === "plugin_release"
      ? "The archive, checksum, embedded release signature, signed files, runtime descriptor, source metadata and source commit were verified."
      : "Source ownership and metadata were verified. Release versions and artifacts are unchanged.",
    banner,
    gallery.length
      ? `<details>\n<summary>Plugin screenshots</summary>\n\n${gallery.join("\n\n")}\n\n</details>`
      : null,
    `${recordStart}${JSON.stringify(request, null, 2)}\n-->`,
    end,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function updateDescription(body = "", request, entry) {
  const generated = renderDescription(request, entry);
  if (body.includes(start) || body.includes(end)) {
    if (
      body.split(start).length !== 2 ||
      body.split(end).length !== 2 ||
      body.indexOf(end) < body.indexOf(start)
    )
      throw new Error("Malformed managed PR description.");
    return (
      body.slice(0, body.indexOf(start)) +
      generated +
      body.slice(body.indexOf(end) + end.length)
    );
  }
  // Remove only the exact legacy template. Any added maintainer prose is retained.
  const legacy =
    /Automated, verified registry update for `[^`]+`\.\s*\n- Source: `[^`]+`\n- Release: `[^`]+`\n- Asset: `[^`]+`(?:\s*\n(?:The archive, checksum[^\n]*|The package coordinates[^\n]*))?/;
  const remaining = body.replace(legacy, "").trim();
  return remaining ? `${remaining}\n\n${generated}` : generated;
}
