#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "jsonc-parser";

import {
  generatedAt,
  generatedDir,
  loadTrustRoot,
  repoRoot,
  sha256,
  stableStringify,
  verifyJson,
} from "./lib/registry.mjs";
import {
  publicKeyPemToRawBase64,
  readDefaultPluginReleaseKey,
} from "./lib/keys.mjs";

const defaultForgejoServer = "https://code.ju.ma";
const defaultForgejoRepo = "lapis-notes/lapis";

export const officialForgejoPluginIds = [
  "lapis-docs",
  "lapis-pdf",
  "lapis-slides",
  "lapis-canvas",
  "lapis-graph",
  "lapis-notebook",
  "lapis-telemetry",
  "lapis-markdown-lint",
];

const pluginSeeds = {
  "lapis-docs": {
    name: "Docs",
    description: "Rich document and spreadsheet editing for Lapis.",
    categories: ["editor", "documents"],
    contributes: {
      editorViews: [
        {
          id: "lapis-docs.document",
          label: "Lapis Document",
          filenamePatterns: ["*.lapisdoc", "*.lapissheet"],
        },
      ],
    },
  },
  "lapis-pdf": {
    name: "PDF",
    description: "PDF viewing for Lapis.",
    categories: ["viewer", "documents"],
    contributes: {
      editorViews: [
        {
          id: "lapis-pdf.viewer",
          label: "PDF",
          filenamePatterns: ["*.pdf"],
        },
      ],
    },
  },
  "lapis-slides": {
    name: "Slides",
    description: "Presentation mode for markdown notes.",
    categories: ["presentation", "markdown"],
  },
  "lapis-canvas": {
    name: "Canvas",
    description: "Infinite canvas view with JSON Canvas support.",
    categories: ["canvas", "visualization"],
    contributes: {
      editorViews: [
        {
          id: "lapis-canvas.editor",
          label: "Canvas",
          filenamePatterns: ["*.canvas"],
        },
      ],
    },
  },
  "lapis-graph": {
    name: "Graph",
    description: "Graph and local graph views powered by the metadata cache.",
    categories: ["graph", "visualization"],
  },
  "lapis-notebook": {
    name: "Notebook",
    description: "Reactive notebook support for markdown notes.",
    categories: ["notebook", "markdown"],
  },
  "lapis-telemetry": {
    name: "Telemetry Diagnostics",
    description: "Telemetry diagnostics view.",
    categories: ["diagnostics", "developer-tools"],
  },
  "lapis-markdown-lint": {
    name: "Markdown Lint",
    description: "Markdown linting diagnostics for Lapis notes.",
    categories: ["markdown", "quality"],
  },
};

export function parseArgs(argv, env = process.env) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const parsed = {
    plugins: officialForgejoPluginIds,
    pluginsExplicit: false,
    releaseTag: "",
    dryRun: false,
    forgejoServer: env.GITHUB_SERVER_URL ?? defaultForgejoServer,
    forgejoRepo: env.GITHUB_REPOSITORY ?? defaultForgejoRepo,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      index += 1;
      if (index >= args.length) throw new Error(`Missing value for ${arg}`);
      return args[index];
    };
    switch (arg) {
      case "--plugins":
        parsed.plugins = parsePluginList(next());
        parsed.pluginsExplicit = true;
        break;
      case "--release-tag":
        parsed.releaseTag = next();
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--forgejo-server":
        parsed.forgejoServer = next();
        break;
      case "--forgejo-repo":
        parsed.forgejoRepo = next();
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

export async function syncForgejoReleases(options = {}) {
  const {
    env = process.env,
    fetchImpl = fetch,
    entriesDir = new URL("entries/official/", repoRoot),
    trustRootPath = new URL("trust/root.json", generatedDir),
  } = options;
  const forgejoServer = normalizeForgejoServer(
    options.forgejoServer ?? defaultForgejoServer,
  );
  const forgejoRepo = options.forgejoRepo ?? defaultForgejoRepo;
  const plugins = options.plugins ?? officialForgejoPluginIds;
  const dryRun = Boolean(options.dryRun);
  const explicit = Boolean(options.pluginsExplicit);
  const releaseAssets = await discoverForgejoReleaseAssets({
    fetchImpl,
    forgejoServer,
    forgejoRepo,
    releaseTag: options.releaseTag ?? "",
    token: env.FORGEJO_TOKEN,
  });
  const latestByPlugin = selectLatestPluginReleaseAssets(
    releaseAssets,
    plugins,
  );
  const trust = await loadSyncTrustRoot({ env, trustRootPath });
  const updates = [];
  const skipped = [];

  for (const pluginId of plugins) {
    const asset = latestByPlugin.get(pluginId);
    if (!asset) {
      if (explicit) {
        throw new Error(`No Forgejo release asset found for ${pluginId}.`);
      }
      skipped.push({ pluginId, reason: "missing-release" });
      continue;
    }

    const update = await buildEntryUpdate({
      pluginId,
      asset,
      fetchImpl,
      trust,
      entriesDir,
    });
    updates.push(update);
  }

  const localReleaseKeyUsed = updates.some((update) => update.localKeyUsed);
  if (!dryRun) {
    for (const update of updates) {
      await writeEntryUpdate({ update, entriesDir });
    }
    if (localReleaseKeyUsed) {
      await writeTrustRoot(trust.root, trustRootPath);
    }
  }

  return {
    dryRun,
    forgejoServer,
    forgejoRepo,
    updates: updates.map((update) => ({
      pluginId: update.entry.id,
      version: update.release.version,
      releaseManifestUrl: update.release.releaseManifest.url,
      releaseManifestSha256: update.release.releaseManifest.sha256,
      releaseManifestSize: update.release.releaseManifest.size,
      files: update.release.files.length,
      entryPath: update.entryPath,
      localKeyUsed: update.localKeyUsed,
    })),
    skipped,
  };
}

export async function discoverForgejoReleaseAssets({
  fetchImpl,
  forgejoServer,
  forgejoRepo,
  releaseTag = "",
  token = "",
}) {
  const releases = releaseTag
    ? [
        await fetchForgejoJson({
          fetchImpl,
          token,
          url: `${forgejoServer}/api/v1/repos/${forgejoRepo}/releases/tags/${encodeURIComponent(releaseTag)}`,
        }),
      ]
    : await fetchForgejoReleasePages({
        fetchImpl,
        token,
        forgejoServer,
        forgejoRepo,
      });
  return releases.flatMap((release) =>
    (release.assets ?? [])
      .map((asset) => ({
        name: asset.name,
        size: asset.size,
        releaseTag: release.tag_name,
        publishedAt: release.published_at ?? release.created_at ?? "",
        url:
          asset.browser_download_url ??
          asset.download_url ??
          forgejoReleaseDownloadUrl({
            forgejoServer,
            forgejoRepo,
            releaseTag: release.tag_name,
            assetName: asset.name,
          }),
      }))
      .filter((asset) => asset.name),
  );
}

export function selectLatestPluginReleaseAssets(assets, plugins) {
  const selected = new Map();
  for (const asset of assets) {
    for (const pluginId of plugins) {
      const match = parseReleaseManifestAssetName(asset.name, pluginId);
      if (!match) continue;
      const candidate = { ...asset, pluginId, version: match.version };
      const current = selected.get(pluginId);
      if (!current || compareVersions(candidate.version, current.version) > 0) {
        selected.set(pluginId, candidate);
      }
    }
  }
  return selected;
}

export function parseReleaseManifestAssetName(assetName, pluginId) {
  const prefix = `${pluginId}-`;
  const suffix = "-release.signed.json";
  if (!assetName.startsWith(prefix) || !assetName.endsWith(suffix)) {
    return null;
  }
  const version = assetName.slice(prefix.length, -suffix.length);
  assertSemver(version);
  return { version };
}

export async function buildEntryUpdate({
  pluginId,
  asset,
  fetchImpl,
  trust,
  entriesDir = new URL("entries/official/", repoRoot),
}) {
  const manifestBytes = await fetchBytes(fetchImpl, asset.url);
  const manifestSha256 = sha256(manifestBytes);
  const envelope = JSON.parse(manifestBytes.toString("utf8"));
  const release = envelope.signed;
  if (!release || !Array.isArray(envelope.signatures)) {
    throw new Error(`${pluginId}: release manifest must be a signed envelope.`);
  }
  if (release.pluginId !== pluginId) {
    throw new Error(`${pluginId}: release manifest pluginId mismatch.`);
  }
  if (release.version !== asset.version) {
    throw new Error(`${pluginId}: release manifest version mismatch.`);
  }
  if (release.channel !== "official") {
    throw new Error(`${pluginId}: release manifest channel must be official.`);
  }
  if (!release.compatibility?.minAppVersion) {
    throw new Error(`${pluginId}: release manifest missing minAppVersion.`);
  }
  if (!Array.isArray(release.compatibility?.platforms)) {
    throw new Error(`${pluginId}: release manifest missing platforms.`);
  }

  const signature = verifyReleaseEnvelope(envelope, trust);
  const files = [];
  for (const file of release.files ?? []) {
    const bytes = await fetchBytes(fetchImpl, file.url);
    const digest = sha256(bytes);
    if (digest !== file.sha256) {
      throw new Error(`${pluginId}: sha256 mismatch for ${file.path}.`);
    }
    if (bytes.byteLength !== file.size) {
      throw new Error(`${pluginId}: size mismatch for ${file.path}.`);
    }
    files.push({
      path: file.path,
      url: file.url,
      sha256: file.sha256,
      size: file.size,
      ...(file.optional ? { optional: true } : {}),
    });
  }

  const existingEntry = await readExistingEntry(pluginId, entriesDir);
  const entry = buildUpdatedEntry({
    pluginId,
    existingEntry,
    release,
    releaseManifest: {
      url: asset.url,
      sha256: manifestSha256,
      size: manifestBytes.byteLength,
    },
    files,
  });
  return {
    entry,
    release: entry.versions[release.version],
    entryPath: `entries/official/${pluginId}.jsonc`,
    localKeyUsed: signature.source === "local",
  };
}

export function buildUpdatedEntry({
  pluginId,
  existingEntry,
  release,
  releaseManifest,
  files,
}) {
  const seed = pluginSeeds[pluginId];
  if (!seed) {
    throw new Error(`No official registry seed configured for ${pluginId}.`);
  }
  const versionEntry = {
    version: release.version,
    minAppVersion: release.compatibility.minAppVersion,
    releasedAt: release.releasedAt ?? generatedAt,
    platforms: release.compatibility.platforms,
    releaseManifest,
    files,
  };
  const entry = {
    $schema: "../../schemas/catalog-entry.schema.json",
    schemaVersion: 1,
    id: pluginId,
    name: existingEntry?.name ?? seed.name,
    description: existingEntry?.description ?? seed.description,
    ...(existingEntry?.readmeUrl ? { readmeUrl: existingEntry.readmeUrl } : {}),
    author: existingEntry?.author ?? "Lapis Notes",
    authorUrl: existingEntry?.authorUrl ?? "https://app.lapis.md",
    channel: "official",
    status: "active",
    latestVersion: release.version,
    minAppVersion: release.compatibility.minAppVersion,
    platforms: existingEntry?.platforms ?? release.compatibility.platforms,
    categories: existingEntry?.categories ?? seed.categories,
    badges: existingEntry?.badges ?? ["official", "verified"],
    owner: existingEntry?.owner ?? { name: "Lapis Notes", verified: true },
    ...(existingEntry?.readme ? { readme: existingEntry.readme } : {}),
    ...((existingEntry?.contributes ?? seed.contributes)
      ? { contributes: existingEntry?.contributes ?? seed.contributes }
      : {}),
    versions: {
      ...nonPendingVersions(existingEntry?.versions ?? {}),
      [release.version]: versionEntry,
    },
  };
  return entry;
}

function nonPendingVersions(versions) {
  return Object.fromEntries(
    Object.entries(versions).filter(
      ([, version]) => !version.releaseManifest?.pending,
    ),
  );
}

export async function loadSyncTrustRoot({
  env = process.env,
  trustRootPath = new URL("trust/root.json", generatedDir),
} = {}) {
  const root = existsSync(trustRootPath)
    ? JSON.parse(await readFile(trustRootPath, "utf8"))
    : await loadTrustRoot();
  const keys = new Map(
    (root.keys ?? []).map((key) => [
      key.keyId,
      { ...key, source: "trust-root" },
    ]),
  );
  const releaseRoles = new Set(root.roles?.release ?? []);
  const extraKeys = [];
  if (
    env.LAPIS_PLUGIN_RELEASE_KEY_ID &&
    env.LAPIS_PLUGIN_RELEASE_PUBLIC_KEY_PEM
  ) {
    extraKeys.push({
      keyId: env.LAPIS_PLUGIN_RELEASE_KEY_ID,
      alg: "ed25519",
      publicKeyPem: env.LAPIS_PLUGIN_RELEASE_PUBLIC_KEY_PEM,
      publicKey:
        env.LAPIS_PLUGIN_RELEASE_PUBLIC_KEY ??
        publicKeyPemToRawBase64(env.LAPIS_PLUGIN_RELEASE_PUBLIC_KEY_PEM),
      source: "local",
    });
  }
  const localReleaseKey = await readDefaultPluginReleaseKey();
  if (localReleaseKey) {
    extraKeys.push({
      keyId: localReleaseKey.keyId,
      alg: "ed25519",
      publicKeyPem: localReleaseKey.publicKeyPem,
      publicKey:
        localReleaseKey.publicKeyRaw ??
        publicKeyPemToRawBase64(localReleaseKey.publicKeyPem),
      source: "local",
    });
  }
  for (const key of extraKeys) {
    if (!keys.has(key.keyId)) keys.set(key.keyId, key);
  }
  const mergedRoot = {
    ...root,
    keys: [...keys.values()]
      .map(({ source: _source, ...key }) => key)
      .sort((a, b) => a.keyId.localeCompare(b.keyId)),
    roles: {
      registry: root.roles?.registry ?? [],
      release: [...releaseRoles].sort(),
    },
  };
  return { root: mergedRoot, keys, releaseRoles };
}

export function verifyReleaseEnvelope(envelope, trust) {
  const payload = envelope.signed;
  for (const signature of envelope.signatures ?? []) {
    const key = trust.keys.get(signature.keyId);
    if (!key) continue;
    if (!verifyJson(payload, signature, key.publicKeyPem)) continue;
    if (!trust.releaseRoles.has(signature.keyId)) {
      if (key.source !== "local") continue;
      trust.releaseRoles.add(signature.keyId);
      trust.root.roles.release = [...trust.releaseRoles].sort();
      if (!trust.root.keys.some((candidate) => candidate.keyId === key.keyId)) {
        trust.root.keys = [
          ...trust.root.keys,
          {
            keyId: key.keyId,
            alg: "ed25519",
            publicKeyPem: key.publicKeyPem,
            publicKey: key.publicKey,
          },
        ].sort((a, b) => a.keyId.localeCompare(b.keyId));
      }
    }
    return { keyId: signature.keyId, source: key.source };
  }
  throw new Error(
    "official release manifest does not have a valid release signature.",
  );
}

async function fetchForgejoReleasePages({
  fetchImpl,
  token,
  forgejoServer,
  forgejoRepo,
}) {
  const releases = [];
  for (let page = 1; page <= 20; page += 1) {
    const pageReleases = await fetchForgejoJson({
      fetchImpl,
      token,
      url: `${forgejoServer}/api/v1/repos/${forgejoRepo}/releases?limit=50&page=${page}`,
    });
    releases.push(...pageReleases);
    if (!Array.isArray(pageReleases) || pageReleases.length < 50) break;
  }
  return releases;
}

async function fetchForgejoJson({ fetchImpl, token, url }) {
  const response = await fetchImpl(url, {
    headers: token ? { Authorization: `token ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Forgejo request failed: ${url} HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchBytes(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function readExistingEntry(pluginId, entriesDir) {
  const entryPath = new URL(`${pluginId}.jsonc`, entriesDir);
  if (!existsSync(entryPath)) return null;
  const errors = [];
  const value = parse(await readFile(entryPath, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0) {
    throw new Error(`${entryPath.pathname}: invalid JSONC`);
  }
  return value;
}

async function writeEntryUpdate({ update, entriesDir }) {
  const target = new URL(`${update.entry.id}.jsonc`, entriesDir);
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, `${stableStringify(update.entry, 2)}\n`);
}

async function writeTrustRoot(root, trustRootPath) {
  await mkdir(new URL("./", trustRootPath), { recursive: true });
  await writeFile(trustRootPath, `${stableStringify(root, 2)}\n`);
}

function parsePluginList(value) {
  const plugins = value
    .split(",")
    .map((pluginId) => pluginId.trim())
    .filter(Boolean);
  if (plugins.length === 0) {
    throw new Error("--plugins must include at least one plugin id");
  }
  const unknown = plugins.filter(
    (pluginId) => !officialForgejoPluginIds.includes(pluginId),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown official Forgejo plugin id: ${unknown.join(", ")}. Known ids: ${officialForgejoPluginIds.join(", ")}`,
    );
  }
  return plugins;
}

function assertSemver(version) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
      version,
    )
  ) {
    throw new Error(`Invalid plugin release version: ${version}`);
  }
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const part of ["major", "minor", "patch"]) {
    if (a[part] !== b[part]) return a[part] - b[part];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function parseVersion(version) {
  assertSemver(version);
  const [core, prerelease = ""] = version.split("-");
  const [major, minor, patch] = core.split(".").map(Number);
  return { major, minor, patch, prerelease };
}

function normalizeForgejoServer(value) {
  return value.replace(/\/+$/, "");
}

function forgejoReleaseDownloadUrl({
  forgejoServer,
  forgejoRepo,
  releaseTag,
  assetName,
}) {
  return `${forgejoServer}/${forgejoRepo}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`;
}

function printHelp() {
  console.log(`Usage: pnpm registry:sync:forgejo -- [options]

Sync official registry entries from app repo Forgejo release assets.

Options:
  --plugins <ids>          Comma-separated official plugin ids. Defaults to all publishable official plugins.
  --release-tag <tag>      Restrict discovery to one Forgejo release tag.
  --dry-run                Print planned updates without writing entries or trust metadata.
  --forgejo-server <url>   Forgejo server. Defaults to https://code.ju.ma.
  --forgejo-repo <repo>    Forgejo repo. Defaults to lapis-notes/lapis.
  --help, -h               Show this help.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const result = await syncForgejoReleases(options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
