#!/usr/bin/env node
import {
  createAjv,
  formatAjvErrors,
  loadEntries,
  validateEntryRules,
  validateRemoteAssets,
} from "./lib/registry.mjs";

const strictRemote = process.argv.includes("--strict-remote");
const entries = await loadEntries();
const ajv = await createAjv();
const validate = ajv.getSchema(
  "https://registry.lapis.md/schemas/catalog-entry.schema.json",
);
const errors = [];

for (const entry of entries) {
  const sourcePath = entry.__sourcePath;
  const schemaEntry = { ...entry };
  delete schemaEntry.__sourcePath;
  if (!validate(schemaEntry)) {
    errors.push(`${sourcePath}: ${formatAjvErrors(validate)}`);
  }
}

errors.push(...validateEntryRules(entries));
if (strictRemote) {
  errors.push(...(await validateRemoteAssets(entries, { strictRemote })));
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `Validated ${entries.length} registry entr${entries.length === 1 ? "y" : "ies"}.`,
);
