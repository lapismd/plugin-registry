#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "jsonc-parser";

import {
  generatedAt,
  generatedDir,
  repoRoot,
  sha256,
  stableStringify,
  verifyJson,
} from "./lib/registry.mjs";
import {
  publicKeyPemToRawBase64,
  readDefaultPluginReleaseKey,
} from "./lib/keys.mjs";
import {
  assertSafePluginRelativePath,
  parsePluginBundle,
  pluginBundleReleaseManifestPath,
} from "./lib/plugin-bundle.mjs";
import {
  applyPluginSourceMetadata,
  fetchPluginSourceMetadata,
} from "./lib/source-metadata.mjs";

const githubApi = "https://api.github.com";
const dispatchAction = "plugin_release";
const metadataDispatchAction = "plugin_metadata";
const payloadKeys = new Set([
  "repository",
  "package_name",
  "plugin_id",
  "version",
  "release_tag",
  "asset_name",
  "source_commit",
]);
const metadataPayloadKeys = new Set([
  "repository",
  "package_name",
  "plugin_id",
  "source_commit",
]);

export async function syncGitHubRelease(options = {}) {
  const {
    env = process.env,
    fetchImpl = fetch,
    entriesDir = new URL("entries/official/", repoRoot),
    trustRootPath = new URL("trust/root.json", generatedDir),
    contentDir = new URL("content/", generatedDir),
    dryRun = false,
  } = options;
  const payload =
    options.payload ??
    parseDispatchEvent(
      JSON.parse(
        await readFile(options.eventPath ?? env.GITHUB_EVENT_PATH, "utf8"),
      ),
    );
  const token = options.token ?? env.GITHUB_TOKEN ?? "";
  const release = await fetchGitHubJson({
    fetchImpl,
    token,
    url: `${githubApi}/repos/${payload.repository}/releases/tags/${encodeURIComponent(payload.releaseTag)}`,
  });
  const asset = requireReleaseAsset(release, payload.assetName);
  const checksumAsset = requireReleaseAsset(
    release,
    `${payload.assetName}.sha256`,
  );
  const [bundleBytes, checksumBytes] = await Promise.all([
    fetchGitHubAsset({ fetchImpl, token, asset }),
    fetchGitHubAsset({ fetchImpl, token, asset: checksumAsset }),
  ]);
  const bundleSha256 = sha256(bundleBytes);
  verifyChecksumFile(checksumBytes, payload.assetName, bundleSha256);
  if (Number.isInteger(asset.size) && asset.size !== bundleBytes.byteLength) {
    throw new Error(`${payload.pluginId}: GitHub asset size mismatch.`);
  }

  const trust = await loadReleaseTrust({ env, trustRootPath });
  const verified = verifyReleaseBundle({
    payload,
    bundleBytes,
    trust,
  });
  const existingEntry = await readExistingEntry(payload.pluginId, entriesDir);
  const releaseEntry = buildUpdatedEntry({
    payload,
    existingEntry,
    manifest: verified.manifest,
    release: verified.release,
    releasedAt: release.published_at ?? release.created_at ?? generatedAt,
    bundle: {
      url: asset.browser_download_url,
      sha256: bundleSha256,
      size: bundleBytes.byteLength,
    },
  });
  const sourceMetadata = await fetchPluginSourceMetadata({
    payload,
    fetchImpl,
    outputDir: contentDir,
  });
  const entry = applyPluginSourceMetadata(releaseEntry, sourceMetadata);
  const changed =
    !existingEntry ||
    stableStringify(existingEntry, 2) !== stableStringify(entry, 2);
  if (!dryRun && changed) {
    await writeEntry(entry, entriesDir);
    if (verified.signature.source === "local") {
      await writeTrustRoot(trust.root, trustRootPath);
    }
  }

  return {
    dryRun: Boolean(dryRun),
    changed,
    repository: payload.repository,
    packageName: payload.packageName,
    pluginId: payload.pluginId,
    version: payload.version,
    releaseTag: payload.releaseTag,
    assetName: payload.assetName,
    bundleUrl: asset.browser_download_url,
    bundleSha256,
    bundleSize: bundleBytes.byteLength,
    signedFiles: verified.release.files.length,
    signingKeyId: verified.signature.keyId,
    entryPath: `entries/official/${payload.pluginId}.jsonc`,
    entry,
  };
}

export async function syncGitHubMetadata(options = {}) {
  const {
    env = process.env,
    fetchImpl = fetch,
    entriesDir = new URL("entries/official/", repoRoot),
    contentDir = new URL("content/", generatedDir),
    dryRun = false,
  } = options;
  const payload =
    options.payload ??
    parseMetadataDispatchEvent(
      JSON.parse(
        await readFile(options.eventPath ?? env.GITHUB_EVENT_PATH, "utf8"),
      ),
    );
  const existingEntry = await readExistingEntry(payload.pluginId, entriesDir);
  if (!existingEntry) {
    throw new Error(
      `${payload.pluginId}: metadata-only sync requires an existing registry entry.`,
    );
  }
  const sourceMetadata = await fetchPluginSourceMetadata({
    payload,
    fetchImpl,
    outputDir: contentDir,
  });
  const entry = applyPluginSourceMetadata(existingEntry, sourceMetadata);
  const changed =
    stableStringify(existingEntry, 2) !== stableStringify(entry, 2);
  if (!dryRun && changed) await writeEntry(entry, entriesDir);

  return {
    action: metadataDispatchAction,
    dryRun: Boolean(dryRun),
    changed,
    repository: payload.repository,
    packageName: payload.packageName,
    pluginId: payload.pluginId,
    sourceCommit: payload.sourceCommit,
    entryPath: `entries/official/${payload.pluginId}.jsonc`,
    entry,
  };
}

export function parseDispatchEvent(event) {
  if (!event || typeof event !== "object") {
    throw new Error("GitHub dispatch event must be an object.");
  }
  if (event.action !== dispatchAction) {
    throw new Error(`Expected repository_dispatch action ${dispatchAction}.`);
  }
  return validateDispatchPayload(event.client_payload);
}

export function parseMetadataDispatchEvent(event) {
  if (!event || typeof event !== "object") {
    throw new Error("GitHub dispatch event must be an object.");
  }
  if (event.action !== metadataDispatchAction) {
    throw new Error(
      `Expected repository_dispatch action ${metadataDispatchAction}.`,
    );
  }
  return validateMetadataDispatchPayload(event.client_payload);
}

export function validateDispatchPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("GitHub dispatch client_payload must be an object.");
  }
  const unknown = Object.keys(input).filter((key) => !payloadKeys.has(key));
  if (unknown.length) {
    throw new Error(`Unknown GitHub dispatch fields: ${unknown.join(", ")}.`);
  }
  for (const key of payloadKeys) {
    if (typeof input[key] !== "string" || !input[key].trim()) {
      throw new Error(
        `GitHub dispatch field ${key} must be a non-empty string.`,
      );
    }
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) {
    throw new Error("GitHub dispatch repository must use owner/name.");
  }
  if (!/^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(input.package_name)) {
    throw new Error(
      "GitHub dispatch package_name must be a scoped npm package.",
    );
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.plugin_id)) {
    throw new Error("GitHub dispatch plugin_id is invalid.");
  }
  assertSemver(input.version);
  if (!/^[0-9a-f]{40}$/.test(input.source_commit)) {
    throw new Error(
      "GitHub dispatch source_commit must be a full Git commit ID.",
    );
  }
  const expectedAssetName = `${input.plugin_id}-${input.version}.lapis-plugin`;
  if (input.asset_name !== expectedAssetName) {
    throw new Error(`GitHub dispatch asset_name must be ${expectedAssetName}.`);
  }
  return {
    repository: input.repository,
    packageName: input.package_name,
    pluginId: input.plugin_id,
    version: input.version,
    releaseTag: input.release_tag,
    assetName: input.asset_name,
    sourceCommit: input.source_commit,
  };
}

export function validateMetadataDispatchPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("GitHub dispatch client_payload must be an object.");
  }
  const unknown = Object.keys(input).filter(
    (key) => !metadataPayloadKeys.has(key),
  );
  if (unknown.length) {
    throw new Error(`Unknown GitHub dispatch fields: ${unknown.join(", ")}.`);
  }
  for (const key of metadataPayloadKeys) {
    if (typeof input[key] !== "string" || !input[key].trim()) {
      throw new Error(
        `GitHub dispatch field ${key} must be a non-empty string.`,
      );
    }
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) {
    throw new Error("GitHub dispatch repository must use owner/name.");
  }
  if (!/^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(input.package_name)) {
    throw new Error(
      "GitHub dispatch package_name must be a scoped npm package.",
    );
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.plugin_id)) {
    throw new Error("GitHub dispatch plugin_id is invalid.");
  }
  if (!/^[0-9a-f]{40}$/.test(input.source_commit)) {
    throw new Error(
      "GitHub dispatch source_commit must be a full Git commit ID.",
    );
  }
  return {
    repository: input.repository,
    packageName: input.package_name,
    pluginId: input.plugin_id,
    sourceCommit: input.source_commit,
  };
}

export function verifyReleaseBundle({ payload, bundleBytes, trust }) {
  const bundledFiles = parsePluginBundle(bundleBytes);
  const releaseBytes = bundledFiles.get(pluginBundleReleaseManifestPath);
  let envelope;
  try {
    envelope = JSON.parse(releaseBytes.toString("utf8"));
  } catch (error) {
    throw new Error(
      `${payload.pluginId}: release.signed.json is invalid JSON.`,
      {
        cause: error,
      },
    );
  }
  const release = envelope.signed;
  if (!release || !Array.isArray(envelope.signatures)) {
    throw new Error(
      `${payload.pluginId}: release manifest must be a signed envelope.`,
    );
  }
  if (release.type !== "lapis.plugin.release" || release.schemaVersion !== 1) {
    throw new Error(
      `${payload.pluginId}: unsupported release manifest contract.`,
    );
  }
  if (
    release.pluginId !== payload.pluginId ||
    release.version !== payload.version
  ) {
    throw new Error(
      `${payload.pluginId}: signed plugin coordinates do not match dispatch.`,
    );
  }
  if (release.channel !== "official") {
    throw new Error(
      `${payload.pluginId}: release manifest channel must be official.`,
    );
  }
  if (
    release.source?.package !== payload.packageName ||
    release.source?.commit !== payload.sourceCommit
  ) {
    throw new Error(
      `${payload.pluginId}: signed source coordinates do not match dispatch.`,
    );
  }
  if (!release.compatibility?.minAppVersion) {
    throw new Error(
      `${payload.pluginId}: release manifest missing minAppVersion.`,
    );
  }
  if (!Array.isArray(release.compatibility?.platforms)) {
    throw new Error(`${payload.pluginId}: release manifest missing platforms.`);
  }
  if (!Array.isArray(release.files) || release.files.length === 0) {
    throw new Error(
      `${payload.pluginId}: release manifest has no signed files.`,
    );
  }
  const signature = verifyReleaseEnvelope(envelope, trust);
  const expectedPaths = new Set();
  for (const file of release.files) {
    assertSafePluginRelativePath(file.path);
    if (expectedPaths.has(file.path)) {
      throw new Error(
        `${payload.pluginId}: duplicate signed file ${file.path}.`,
      );
    }
    expectedPaths.add(file.path);
    const bytes = bundledFiles.get(file.path);
    if (!bytes)
      throw new Error(`${payload.pluginId}: bundle is missing ${file.path}.`);
    if (sha256(bytes) !== file.sha256) {
      throw new Error(`${payload.pluginId}: sha256 mismatch for ${file.path}.`);
    }
    if (bytes.byteLength !== file.size) {
      throw new Error(`${payload.pluginId}: size mismatch for ${file.path}.`);
    }
  }
  const extraPaths = [...bundledFiles.keys()].filter(
    (entryPath) =>
      entryPath !== pluginBundleReleaseManifestPath &&
      !expectedPaths.has(entryPath),
  );
  if (extraPaths.length) {
    throw new Error(
      `${payload.pluginId}: bundle includes unsigned files: ${extraPaths.join(", ")}.`,
    );
  }
  for (const requiredPath of ["manifest.json", "main.mjs", "styles.css"]) {
    if (!expectedPaths.has(requiredPath)) {
      throw new Error(
        `${payload.pluginId}: signed bundle is missing ${requiredPath}.`,
      );
    }
  }
  const manifest = JSON.parse(
    bundledFiles.get("manifest.json").toString("utf8"),
  );
  if (
    manifest.id !== payload.pluginId ||
    manifest.version !== payload.version
  ) {
    throw new Error(
      `${payload.pluginId}: runtime manifest coordinates do not match.`,
    );
  }
  const runtimeEntries = release.runtime?.entries;
  if (!runtimeEntries || typeof runtimeEntries !== "object") {
    throw new Error(
      `${payload.pluginId}: signed runtime descriptor is missing.`,
    );
  }
  for (const descriptor of Object.values(runtimeEntries)) {
    assertSafePluginRelativePath(descriptor.path);
    if (descriptor.format !== "esm" || !expectedPaths.has(descriptor.path)) {
      throw new Error(
        `${payload.pluginId}: signed runtime descriptor is invalid.`,
      );
    }
  }
  if (
    stableStringify(manifest.lapis?.runtime?.entries ?? {}, 0) !==
    stableStringify(runtimeEntries, 0)
  ) {
    throw new Error(`${payload.pluginId}: runtime descriptors do not match.`);
  }
  return { release, manifest, signature };
}

export function buildUpdatedEntry({
  payload,
  existingEntry,
  manifest,
  release,
  releasedAt,
  bundle,
}) {
  const packageDirectory = payload.releaseTag.split("@")[0];
  const readmeUrl =
    payload.repository === "lapismd/lapis-plugins"
      ? `https://raw.githubusercontent.com/${payload.repository}/${payload.sourceCommit}/packages/${packageDirectory}/README.md`
      : `https://raw.githubusercontent.com/${payload.repository}/${payload.sourceCommit}/README.md`;
  const versionEntry = {
    version: payload.version,
    minAppVersion: release.compatibility.minAppVersion,
    releasedAt: normalizeDate(releasedAt),
    platforms: release.compatibility.platforms,
    bundle,
  };
  const versions = {
    ...(existingEntry?.versions ?? {}),
    [payload.version]: versionEntry,
  };
  const category = payload.pluginId.replace(/^lapis-/, "") || "plugin";
  return {
    $schema: "../../schemas/catalog-entry.schema.json",
    schemaVersion: 1,
    id: payload.pluginId,
    name: existingEntry?.name ?? manifest.name,
    description: existingEntry?.description ?? manifest.description,
    readmeUrl,
    author: existingEntry?.author ?? manifest.author ?? "Lapis Notes",
    authorUrl:
      existingEntry?.authorUrl ??
      manifest.authorUrl ??
      `https://github.com/${payload.repository.split("/")[0]}`,
    channel: "official",
    status: "active",
    latestVersion: payload.version,
    minAppVersion: release.compatibility.minAppVersion,
    platforms: release.compatibility.platforms,
    categories: existingEntry?.categories ?? [category],
    badges: existingEntry?.badges ?? ["official", "verified"],
    owner: existingEntry?.owner ?? { name: "Lapis Notes", verified: true },
    source: {
      repository: payload.repository,
      packageName: payload.packageName,
      releaseTag: payload.releaseTag,
      sourceCommit: payload.sourceCommit,
    },
    ...(existingEntry?.contributes
      ? { contributes: existingEntry.contributes }
      : {}),
    versions,
  };
}

export function verifyChecksumFile(bytes, assetName, expectedSha256) {
  const value = bytes.toString("utf8");
  const match = value.match(/^([a-f0-9]{64})  ([^\r\n]+)\r?\n?$/);
  if (!match || match[2] !== assetName) {
    throw new Error(`GitHub checksum asset must name ${assetName}.`);
  }
  if (match[1] !== expectedSha256) {
    throw new Error(`GitHub checksum does not match ${assetName}.`);
  }
}

async function loadReleaseTrust({ env, trustRootPath }) {
  const root = JSON.parse(await readFile(trustRootPath, "utf8"));
  const keys = new Map(
    (root.keys ?? []).map((key) => [
      key.keyId,
      { ...key, source: "trust-root" },
    ]),
  );
  const releaseRoles = new Set(root.roles?.release ?? []);
  const extras = [];
  if (
    env.LAPIS_PLUGIN_RELEASE_KEY_ID &&
    env.LAPIS_PLUGIN_RELEASE_PUBLIC_KEY_PEM
  ) {
    extras.push({
      keyId: env.LAPIS_PLUGIN_RELEASE_KEY_ID,
      alg: "ed25519",
      publicKeyPem: env.LAPIS_PLUGIN_RELEASE_PUBLIC_KEY_PEM,
      publicKey:
        env.LAPIS_PLUGIN_RELEASE_PUBLIC_KEY ??
        publicKeyPemToRawBase64(env.LAPIS_PLUGIN_RELEASE_PUBLIC_KEY_PEM),
      source: "local",
    });
  }
  const localKey = await readDefaultPluginReleaseKey();
  if (localKey) {
    extras.push({
      keyId: localKey.keyId,
      alg: "ed25519",
      publicKeyPem: localKey.publicKeyPem,
      publicKey:
        localKey.publicKeyRaw ?? publicKeyPemToRawBase64(localKey.publicKeyPem),
      source: "local",
    });
  }
  for (const key of extras) if (!keys.has(key.keyId)) keys.set(key.keyId, key);
  return { root, keys, releaseRoles };
}

function verifyReleaseEnvelope(envelope, trust) {
  for (const signature of envelope.signatures ?? []) {
    const key = trust.keys.get(signature.keyId);
    if (!key || !verifyJson(envelope.signed, signature, key.publicKeyPem))
      continue;
    if (!trust.releaseRoles.has(signature.keyId)) {
      if (key.source !== "local") continue;
      trust.releaseRoles.add(signature.keyId);
      trust.root.roles.release = [...trust.releaseRoles].sort();
      if (!trust.root.keys.some((candidate) => candidate.keyId === key.keyId)) {
        const { source: _source, ...publicKey } = key;
        trust.root.keys = [...trust.root.keys, publicKey].sort((left, right) =>
          left.keyId.localeCompare(right.keyId),
        );
      }
    }
    return { keyId: signature.keyId, source: key.source };
  }
  throw new Error(
    "official release manifest does not have a valid release signature.",
  );
}

function requireReleaseAsset(release, name) {
  const asset = release.assets?.find((candidate) => candidate.name === name);
  if (!asset?.browser_download_url) {
    throw new Error(
      `GitHub release ${release.tag_name ?? "unknown"} is missing ${name}.`,
    );
  }
  return asset;
}

async function fetchGitHubJson({ fetchImpl, token, url }) {
  const response = await fetchImpl(url, {
    headers: githubHeaders(token, "application/vnd.github+json"),
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${url} HTTP ${response.status}.`);
  }
  return response.json();
}

async function fetchGitHubAsset({ fetchImpl, token, asset }) {
  const response = await fetchImpl(asset.browser_download_url, {
    headers: githubHeaders(token, "application/octet-stream"),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub asset request failed: ${asset.name} HTTP ${response.status}.`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function githubHeaders(token, accept) {
  return {
    Accept: accept,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readExistingEntry(pluginId, entriesDir) {
  const entryPath = new URL(`${pluginId}.jsonc`, entriesDir);
  if (!existsSync(entryPath)) return null;
  const errors = [];
  const value = parse(await readFile(entryPath, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length) throw new Error(`${entryPath.pathname}: invalid JSONC.`);
  return value;
}

async function writeEntry(entry, entriesDir) {
  const target = new URL(`${entry.id}.jsonc`, entriesDir);
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, `${stableStringify(entry, 2)}\n`);
}

async function writeTrustRoot(root, trustRootPath) {
  await mkdir(new URL("./", trustRootPath), { recursive: true });
  await writeFile(trustRootPath, `${stableStringify(root, 2)}\n`);
}

function normalizeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid release date: ${value}.`);
  return date.toISOString();
}

function assertSemver(version) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
      version,
    )
  ) {
    throw new Error(`Invalid plugin release version: ${version}.`);
  }
}

function parseArgs(args) {
  const options = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--event-path") options.eventPath = args[++index];
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown option: ${arg}.`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const event = JSON.parse(
    await readFile(options.eventPath ?? process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  const result =
    event.action === metadataDispatchAction
      ? await syncGitHubMetadata({
          ...options,
          payload: parseMetadataDispatchEvent(event),
        })
      : await syncGitHubRelease({
          ...options,
          payload: parseDispatchEvent(event),
        });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
