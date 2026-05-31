#!/usr/bin/env node
import { promises as fs } from "node:fs";
import {
  buildRegistry,
  generatedDir,
  loadEntries,
  readJsonIfExists,
  writeJson,
} from "./lib/registry.mjs";

const entries = await loadEntries();
const registry = buildRegistry(entries);

await fs.mkdir(generatedDir, { recursive: true });
await fs.mkdir(new URL("plugins/", generatedDir), { recursive: true });
await fs.mkdir(new URL("trust/", generatedDir), { recursive: true });

await writeSignedJsonIfSidecarExists("index.json", registry.index);
for (const [pluginId, detail] of Object.entries(registry.details)) {
  await writeSignedJsonIfSidecarExists(`plugins/${pluginId}.json`, detail);
}
await writeSignedJsonIfSidecarExists("revoked.json", registry.revoked);

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
