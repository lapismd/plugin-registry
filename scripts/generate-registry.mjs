#!/usr/bin/env node
import { promises as fs } from "node:fs";
import {
  buildRegistry,
  generatedDir,
  loadEntries,
  writeJson,
} from "./lib/registry.mjs";

const entries = await loadEntries();
const registry = buildRegistry(entries);

await fs.mkdir(generatedDir, { recursive: true });
await fs.mkdir(new URL("plugins/", generatedDir), { recursive: true });
await fs.mkdir(new URL("trust/", generatedDir), { recursive: true });

await writeJson(new URL("index.json", generatedDir), registry.index);
for (const [pluginId, detail] of Object.entries(registry.details)) {
  await writeJson(new URL(`plugins/${pluginId}.json`, generatedDir), detail);
}
await writeJson(new URL("revoked.json", generatedDir), registry.revoked);

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
