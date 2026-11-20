import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Registry deployment owns signed catalog bytes; npm dependency intake must not
// turn this private application into a package/version publisher.
export function checkDependencyContract(manifest) {
  assert.equal(
    manifest.name,
    "lapis-plugin-registry",
    "registry root identity",
  );
  assert.equal(manifest.private, true, "registry root must remain private");
  assert.equal(manifest.publishConfig, undefined, "no npm publication config");
  assert.equal(manifest.workspaces, undefined, "single registry application");
  assert.match(manifest.packageManager, /^pnpm@\d+\.\d+\.\d+$/, "pinned pnpm");
  const inputs = [];
  for (const type of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ])
    for (const [name, range] of Object.entries(manifest[type] ?? {}))
      if (/^@(?:lapismd|lapis-notes)\//.test(name))
        inputs.push({ type, name, range });
  assert.equal(inputs.length, 1, "one qualified first-party dependency");
  assert.equal(inputs[0].type, "dependencies", "API owns the runtime schema");
  assert.equal(inputs[0].name, "@lapis-notes/api", "qualified API dependency");
  const patch = /^\^0\.6\.(0|[1-9]\d*)$/.exec(inputs[0].range);
  assert(
    patch && Number(patch[1]) >= 11,
    "API intake stays on qualified 0.6 patches from 0.6.11",
  );
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    assert(!/^(?:release|version)(?::|$)/.test(name), "no npm version recipe");
    assert(
      !/\b(?:deno|changeset)\b/.test(command),
      "Node-only, no version writer",
    );
  }
  assert.equal(
    manifest.scripts?.["registry:generate"],
    "node scripts/generate-registry.mjs",
  );
  assert.equal(
    manifest.scripts?.["registry:verify-signatures"],
    "node scripts/verify-signatures.mjs",
  );
  return {
    application: manifest.name,
    dependency: inputs[0],
    versionIntent: false,
  };
}

function snapshotEntry(lockfile, packageName, version) {
  const snapshotsStart = lockfile.indexOf("\nsnapshots:\n");
  assert(snapshotsStart >= 0, "pnpm lock contains snapshots");
  const snapshots = lockfile.slice(snapshotsStart);
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(
    `^  ["']${escapedName}@${escapedVersion}(?:\\([^\\n]+\\))?["']:$`,
    "m",
  ).exec(snapshots);
  assert(heading, `${packageName} ${version} has an active lock snapshot`);
  const start = heading.index;
  const next = snapshots.slice(start + heading[0].length).search(/^  \S/m);
  return snapshots.slice(
    start,
    next === -1 ? undefined : start + heading[0].length + next,
  );
}

function qualifiedSnapshotVersion(snapshot, packageName, family, minimumPatch) {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedFamily = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `^      ["']${escapedName}["']: (${escapedFamily}\\.(0|[1-9]\\d*))(?:\\(|$)`,
    "m",
  ).exec(snapshot);
  assert(
    match && Number(match[2]) >= minimumPatch,
    `${packageName} lock closure stays on qualified ${family} patches from ${family}.${minimumPatch}`,
  );
  return match[1];
}

export function checkDependencyLock(manifest, lockfile) {
  const contract = checkDependencyContract(manifest);
  const importersStart = lockfile.indexOf("\nimporters:\n");
  const packagesStart = lockfile.indexOf("\npackages:\n");
  assert(
    importersStart >= 0 && packagesStart > importersStart,
    "pnpm lock sections",
  );
  const importer = lockfile.slice(importersStart, packagesStart);
  const firstPartyInputs = [
    ...importer.matchAll(
      /^      ["'](@(?:lapismd|lapis-notes)\/[^"']+)["']:/gm,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(
    firstPartyInputs,
    ["@lapis-notes/api"],
    "lock importer retains one qualified first-party dependency",
  );
  const escapedRange = contract.dependency.range.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const resolution = new RegExp(
    `^      ["']@lapis-notes/api["']:\\n        specifier: ${escapedRange}\\n        version: (0\\.6\\.(0|[1-9]\\d*))(?:\\(|$)`,
    "m",
  ).exec(importer);
  assert(
    resolution && Number(resolution[2]) >= 11,
    "lock resolves the qualified API 0.6 range from 0.6.11",
  );
  const api = snapshotEntry(lockfile, "@lapis-notes/api", resolution[1]);
  const closure = {
    api: resolution[1],
    ui: qualifiedSnapshotVersion(api, "@lapis-notes/ui", "0.2", 8),
    designCore: qualifiedSnapshotVersion(
      api,
      "@lapismd/design-core",
      "0.13",
      7,
    ),
    mira: qualifiedSnapshotVersion(api, "@lapismd/mira", "0.2", 0),
  };
  for (const [name, version] of [
    ["@lapis-notes/ui", closure.ui],
    ["@lapismd/design-core", closure.designCore],
    ["@lapismd/mira", closure.mira],
  ])
    snapshotEntry(lockfile, name, version);
  return closure;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url)),
  );
  const lockfile = readFileSync(
    new URL("../pnpm-lock.yaml", import.meta.url),
    "utf8",
  );
  const closure = checkDependencyLock(manifest, lockfile);
  console.log(
    `Registry dependency contract: private Node application; API ${closure.api} with qualified current closure; no npm version intent.`,
  );
}
