import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  buildRegistry,
  generatedDir,
  listFiles,
  loadEntries,
  writeJson,
} from "./registry.mjs";
import {
  applyPluginSourceMetadata,
  fetchPluginSourceMetadata,
} from "./source-metadata.mjs";

const localSourceCommit = "0".repeat(40);

export async function buildLocalSourcePreview({
  sourceDir,
  outputDir,
  entries,
  baseRegistryDir = generatedDir,
  registryBaseUrl = "http://localhost:4321/v1/",
}) {
  const sourceRoot = path.resolve(String(sourceDir));
  const outputRoot = directoryUrl(outputDir);
  await access(sourceRoot);
  await mkdir(outputRoot, { recursive: true });
  await cp(directoryUrl(baseRegistryDir), outputRoot, { recursive: true });

  const registryEntries = entries ?? (await loadEntries());
  const updatedPluginIds = [];
  const previewEntries = [];

  for (const entry of registryEntries) {
    const packageRoot = localPackageRoot(sourceRoot, entry);
    if (
      !packageRoot ||
      !(await exists(path.join(packageRoot, "registry.json")))
    ) {
      previewEntries.push(entry);
      continue;
    }

    const payload = {
      repository: entry.source.repository,
      packageName: entry.source.packageName,
      pluginId: entry.id,
      sourceCommit: localSourceCommit,
    };
    const sourceMetadata = await fetchPluginSourceMetadata({
      payload,
      fetchImpl: localSourceFetch(payload, packageRoot),
      outputDir: new URL("content/", outputRoot),
      assetOutputDir: new URL("assets/", outputRoot),
      registryBaseUrl,
    });
    previewEntries.push(
      applyLocalSourceManifest(
        applyPluginSourceMetadata(entry, sourceMetadata),
        sourceMetadata,
      ),
    );
    updatedPluginIds.push(entry.id);
  }

  if (updatedPluginIds.length === 0) {
    throw new Error(
      `No registry entries matched local plugin source at ${sourceRoot}.`,
    );
  }

  const registry = buildRegistry(previewEntries);
  await writeJson(new URL("index.json", outputRoot), registry.index);
  await mkdir(new URL("plugins/", outputRoot), { recursive: true });
  for (const [pluginId, detail] of Object.entries(registry.details)) {
    await writeJson(new URL(`plugins/${pluginId}.json`, outputRoot), detail);
  }
  await writeJson(new URL("revoked.json", outputRoot), registry.revoked);

  const signatures = await listFiles(outputRoot, (file) =>
    file.pathname.endsWith(".sig"),
  );
  await Promise.all(signatures.map((file) => rm(file)));

  return {
    outputDir: outputRoot.pathname,
    sourceDir: sourceRoot,
    updatedPluginIds: updatedPluginIds.sort(),
    unsigned: true,
  };
}

function applyLocalSourceManifest(entry, metadata) {
  const version = metadata.version;
  const baseRelease =
    entry.versions[version] ?? entry.versions[entry.latestVersion];
  if (!baseRelease) {
    throw new Error(
      `${entry.id}: local source preview requires a release template.`,
    );
  }
  const minAppVersion = metadata.minAppVersion ?? entry.minAppVersion;
  return {
    ...entry,
    latestVersion: version,
    minAppVersion,
    platforms: metadata.platforms,
    versions: {
      ...entry.versions,
      [version]: {
        ...baseRelease,
        version,
        status: "pending",
        minAppVersion,
        platforms: metadata.platforms,
        bundle: {
          url: `https://registry.lapis.md/local-source-preview/${encodeURIComponent(entry.id)}/${encodeURIComponent(version)}.lapis-plugin`,
          sha256: "0".repeat(64),
          size: 0,
          pending: true,
        },
      },
    },
  };
}

function localPackageRoot(sourceRoot, entry) {
  const source = entry.source;
  if (!source?.repository || !source.packageName) return null;
  if (source.repository === "lapismd/lapis-plugins") {
    const packageSlug = source.packageName.split("/")[1];
    return packageSlug ? path.join(sourceRoot, "packages", packageSlug) : null;
  }
  return sourceRoot;
}

function localSourceFetch(payload, packageRoot) {
  const remotePackageRoot =
    payload.repository === "lapismd/lapis-plugins"
      ? `packages/${payload.packageName.split("/")[1]}/`
      : "";
  const remoteBase = `https://raw.githubusercontent.com/${payload.repository}/${payload.sourceCommit}/${remotePackageRoot}`;

  return async (input) => {
    const url = String(input);
    if (!url.startsWith(remoteBase)) return new Response(null, { status: 404 });
    const relativePath = decodeURIComponent(url.slice(remoteBase.length));
    if (
      !relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..")
    ) {
      return new Response(null, { status: 400 });
    }
    try {
      const bytes = await readFile(path.join(packageRoot, relativePath));
      return new Response(bytes, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength) },
      });
    } catch (error) {
      if (error?.code === "ENOENT") return new Response(null, { status: 404 });
      throw error;
    }
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function directoryUrl(value) {
  if (value instanceof URL) {
    return new URL(
      value.pathname.endsWith("/") ? value.href : `${value.href}/`,
    );
  }
  const resolved = path.resolve(String(value));
  return new URL(
    `file://${resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`}`,
  );
}
