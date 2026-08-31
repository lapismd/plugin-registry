import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLocalSourcePreview } from "./local-source-preview.mjs";

const registrySourceFileNames = new Set([
  "CHANGELOG.md",
  "manifest.json",
  "package.json",
  "registry.json",
]);
const ignoredSourceSegments = new Set([
  ".git",
  ".jj",
  ".svelte-kit",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "storybook-static",
  "tmp",
]);

export async function refreshLocalSourcePreview({
  sourceDir,
  outputDir,
  stagingDir,
  entries,
  baseRegistryDir,
  registryBaseUrl,
}) {
  const outputRoot = filePath(outputDir);
  const stagingRoot = filePath(
    stagingDir ?? path.join(path.dirname(outputRoot), "staging"),
  );
  await mkdir(stagingRoot, { recursive: true });
  const snapshotRoot = await mkdtemp(path.join(stagingRoot, "refresh-"));
  const snapshotRegistryDir = path.join(snapshotRoot, "v1");

  try {
    const preview = await buildLocalSourcePreview({
      sourceDir,
      outputDir: snapshotRegistryDir,
      entries,
      baseRegistryDir,
      registryBaseUrl,
    });
    await publishLocalSourcePreview(snapshotRegistryDir, outputRoot);
    return { ...preview, outputDir: outputRoot };
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
}

export function watchLocalSourcePreview({
  sourceDir,
  refresh,
  debounceMs = 150,
  watchFactory = watch,
  onSuccess = () => {},
  onError = () => {},
}) {
  if (typeof refresh !== "function") {
    throw new TypeError("Local source preview refresh must be a function.");
  }

  let activeRefresh = null;
  let closed = false;
  let debounceTimer = null;
  let dirty = false;
  const changedPaths = new Set();
  const idleResolvers = new Set();
  const watcher = watchFactory(
    filePath(sourceDir),
    { recursive: true },
    (_eventType, filename) => {
      if (!isLocalSourcePreviewInput(filename)) return;
      scheduleRefresh(filename);
    },
  );

  watcher.on?.("error", (error) => reportError(error, []));

  function scheduleRefresh(filename) {
    if (closed) return;
    dirty = true;
    changedPaths.add(normalizeChangedPath(filename));
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(startRefresh, debounceMs);
  }

  function startRefresh() {
    debounceTimer = null;
    if (closed || activeRefresh || !dirty) return;

    dirty = false;
    const refreshedPaths = [...changedPaths].sort();
    changedPaths.clear();
    activeRefresh = (async () => {
      try {
        const result = await refresh(refreshedPaths);
        onSuccess(result, refreshedPaths);
      } catch (error) {
        reportError(error, refreshedPaths);
      }
    })().finally(() => {
      activeRefresh = null;
      if (!closed && dirty) {
        debounceTimer = setTimeout(startRefresh, debounceMs);
      } else {
        resolveIdle();
      }
    });
  }

  function reportError(error, refreshedPaths) {
    try {
      onError(error, refreshedPaths);
    } catch (reportingError) {
      console.error(reportingError);
    }
  }

  function resolveIdle() {
    if (activeRefresh || debounceTimer || dirty) return;
    for (const resolve of idleResolvers) resolve();
    idleResolvers.clear();
  }

  return {
    async close() {
      if (closed) return;
      closed = true;
      watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      dirty = false;
      changedPaths.clear();
      await activeRefresh;
      resolveIdle();
    },
    waitForIdle() {
      if (!activeRefresh && !debounceTimer && !dirty) {
        return Promise.resolve();
      }
      return new Promise((resolve) => idleResolvers.add(resolve));
    },
  };
}

export function isLocalSourcePreviewInput(filename) {
  if (filename === null || filename === undefined) return true;
  const normalized = String(filename).replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => ignoredSourceSegments.has(segment))) {
    return false;
  }
  if (
    segments.includes("registry-assets") ||
    segments.includes("registry-content")
  ) {
    return true;
  }
  return registrySourceFileNames.has(segments.at(-1));
}

async function publishLocalSourcePreview(sourceRoot, outputRoot) {
  await mkdir(outputRoot, { recursive: true });
  const relativeFiles = await listRelativeFiles(sourceRoot);
  const indexFiles = relativeFiles.filter((file) => file === "index.json");
  const metadataFiles = relativeFiles.filter(
    (file) => file === "revoked.json" || /^plugins\/[^/]+\.json$/.test(file),
  );
  const contentFiles = relativeFiles.filter(
    (file) => !indexFiles.includes(file) && !metadataFiles.includes(file),
  );

  for (const relativePath of [
    ...contentFiles,
    ...metadataFiles,
    ...indexFiles,
  ]) {
    await atomicCopyFile(
      path.join(sourceRoot, relativePath),
      path.join(outputRoot, relativePath),
    );
  }

  const staleSignatures = (await listRelativeFiles(outputRoot)).filter((file) =>
    file.endsWith(".sig"),
  );
  await Promise.all(
    staleSignatures.map((file) =>
      rm(path.join(outputRoot, file), { force: true }),
    ),
  );
}

async function atomicCopyFile(sourcePath, destinationPath) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await copyFile(sourcePath, temporaryPath);
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function listRelativeFiles(root) {
  const files = [];
  await visit(root, "");
  return files.sort();

  async function visit(currentRoot, relativeRoot) {
    const entries = await readdir(currentRoot, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeRoot
        ? path.join(relativeRoot, entry.name)
        : entry.name;
      const absolutePath = path.join(currentRoot, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else {
        files.push(relativePath.split(path.sep).join("/"));
      }
    }
  }
}

function normalizeChangedPath(filename) {
  if (filename === null || filename === undefined) return "<unknown>";
  return String(filename).replaceAll("\\", "/");
}

function filePath(value) {
  return value instanceof URL
    ? fileURLToPath(value)
    : path.resolve(String(value));
}
