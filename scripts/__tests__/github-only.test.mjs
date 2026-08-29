import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const obsoleteMarkers = [
  ["code", "ju", "ma"].join("."),
  ["forge", "jo"].join(""),
];
const sourceRoots = [
  ".github",
  "docs",
  "entries",
  "generated",
  "public",
  "schemas",
  "scripts",
  "src",
  "PLAN.md",
  "README.md",
  "package.json",
];
const textExtensions = new Set([
  ".astro",
  ".css",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".sig",
  ".ts",
  ".yaml",
  ".yml",
]);

test("repository automation and references are GitHub-only", async () => {
  const failures = [];
  for (const relativeRoot of sourceRoots) {
    const target = new URL(relativeRoot, root);
    for (const filename of await filesUnder(target)) {
      if (!textExtensions.has(path.extname(filename.pathname))) continue;
      const source = (await fs.readFile(filename, "utf8")).toLowerCase();
      if (obsoleteMarkers.some((marker) => source.includes(marker))) {
        failures.push(path.relative(root.pathname, filename.pathname));
      }
    }
  }
  assert.deepEqual(failures, []);
});

async function filesUnder(target) {
  const stat = await fs.stat(target);
  if (stat.isFile()) return [target];
  const files = [];
  for (const entry of await fs.readdir(target, { withFileTypes: true })) {
    const child = new URL(entry.name, ensureDirectoryUrl(target));
    if (entry.isDirectory()) files.push(...(await filesUnder(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function ensureDirectoryUrl(value) {
  return new URL(
    value.pathname.endsWith("/") ? value.pathname : `${value.pathname}/`,
    value,
  );
}
