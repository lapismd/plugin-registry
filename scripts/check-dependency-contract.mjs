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
  const patch = /^\^0\.1\.(0|[1-9]\d*)$/.exec(inputs[0].range);
  assert(
    patch && Number(patch[1]) >= 2,
    "API intake stays on qualified 0.1 patches",
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

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url)),
  );
  checkDependencyContract(manifest);
  console.log(
    "Registry dependency contract: private Node application; API 0.1 patches; no npm version intent.",
  );
}
