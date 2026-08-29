#!/usr/bin/env node
import { promises as fs } from "node:fs";
import {
  buildRegistry,
  downloadTargetsFile,
  generatedDir,
  loadEntries,
  readJsonIfExists,
  stableStringify,
  writeJson,
} from "./lib/registry.mjs";

const entries = await loadEntries();
const registry = buildRegistry(entries);

await fs.mkdir(generatedDir, { recursive: true });
const generatedPluginsDir = new URL("plugins/", generatedDir);
await fs.mkdir(generatedPluginsDir, { recursive: true });
await fs.mkdir(new URL("trust/", generatedDir), { recursive: true });

await pruneRemovedPluginMetadata(Object.keys(registry.details));

await writeSignedJsonIfSidecarExists("index.json", registry.index);
for (const [pluginId, detail] of Object.entries(registry.details)) {
  await writeSignedJsonIfSidecarExists(`plugins/${pluginId}.json`, detail);
}
await writeSignedJsonIfSidecarExists("revoked.json", registry.revoked);
await fs.writeFile(
  downloadTargetsFile,
  `export const downloadTargets = ${stableStringify(registry.downloadTargets, 2)};\n`,
);

try {
  await fs.access(new URL("trust/root.json", generatedDir));
} catch {
  await writeJson(new URL("trust/root.json", generatedDir), {
    schemaVersion: 1,
    generatedAt: registry.index.generatedAt,
    keys: [],
    roles: {
      registry: [],
      release: [],
    },
  });
}

console.log(
  `Generated registry with ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`,
);

async function writeSignedJsonIfSidecarExists(relativePath, value) {
  const sidecarPath = relativePath.replace(/\.json$/, ".sig");
  const sidecar = await readJsonIfExists(new URL(sidecarPath, generatedDir));
  await writeJson(
    new URL(relativePath, generatedDir),
    sidecar ? { ...value, signatures: [sidecar] } : value,
  );
}

async function pruneRemovedPluginMetadata(pluginIds) {
  const expectedFiles = new Set(
    pluginIds.flatMap((pluginId) => [`${pluginId}.json`, `${pluginId}.sig`]),
  );
  const existingFiles = await fs.readdir(generatedPluginsDir, {
    withFileTypes: true,
  });

  await Promise.all(
    existingFiles
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.(?:json|sig)$/.test(entry.name) &&
          !expectedFiles.has(entry.name),
      )
      .map((entry) => fs.rm(new URL(entry.name, generatedPluginsDir))),
  );
}
