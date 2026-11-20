import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  checkDependencyContract,
  checkDependencyLock,
} from "../check-dependency-contract.mjs";

const manifest = () =>
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url)));
const lockfile = () =>
  readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8");

test("current registry retains private signed-deployment authority", () => {
  const result = checkDependencyContract(manifest());
  assert.equal(result.versionIntent, false);
  assert.equal(result.dependency.name, "@lapis-notes/api");
});

test("the current lock resolves the qualified API closure", () => {
  assert.deepEqual(checkDependencyLock(manifest(), lockfile()), {
    api: "0.6.12",
    ui: "0.2.8",
    designCore: "0.13.7",
    mira: "0.2.0",
  });
});

test("a future compatible API patch retains the no-version contract", () => {
  const value = manifest();
  value.dependencies["@lapis-notes/api"] = "^0.6.999";
  assert.equal(checkDependencyContract(value).versionIntent, false);
});

for (const range of [
  "^0.6.10",
  "^0.7.0",
  "^1.0.0",
  "*",
  "catalog:",
  "file:../api",
  "^0.6.12-next.0",
])
  test(`unsupported API boundary remains held: ${range}`, () => {
    const value = manifest();
    value.dependencies["@lapis-notes/api"] = range;
    assert.throws(
      () => checkDependencyContract(value),
      /qualified 0.6 patches/,
    );
  });

for (const [name, search, replacement, reason] of [
  [
    "stale UI closure",
    /["']@lapis-notes\/ui["']: 0\.2\.8\(/,
    '"@lapis-notes/ui": 0.1.2(',
    /qualified 0\.2 patches/,
  ],
  [
    "stale Design Core closure",
    /["']@lapismd\/design-core["']: 0\.13\.7\(/,
    '"@lapismd/design-core": 0.3.2(',
    /qualified 0\.13 patches/,
  ],
  [
    "stale Mira closure",
    /["']@lapismd\/mira["']: 0\.2\.0\(/,
    '"@lapismd/mira": 0.0.3(',
    /qualified 0\.2 patches/,
  ],
])
  test(`${name} is rejected`, () => {
    const stale = lockfile().replace(search, replacement);
    assert.notEqual(stale, lockfile());
    assert.throws(() => checkDependencyLock(manifest(), stale), reason);
  });

test("an unrelated first-party lock importer is rejected", () => {
  const changed = lockfile().replace(
    "    dependencies:\n",
    '    dependencies:\n      "@lapismd/unqualified":\n        specifier: ^0.1.0\n        version: 0.1.0\n',
  );
  assert.throws(
    () => checkDependencyLock(manifest(), changed),
    /one qualified first-party dependency/,
  );
});

for (const [name, change, reason] of [
  [
    "public root",
    (m) => {
      m.private = false;
    },
    /must remain private/,
  ],
  [
    "npm publisher",
    (m) => {
      m.publishConfig = { access: "public" };
    },
    /publication config/,
  ],
  [
    "new version recipe",
    (m) => {
      m.scripts["release:version"] = "node version.mjs";
    },
    /version recipe/,
  ],
  [
    "Deno runtime",
    (m) => {
      m.scripts["runtime:check"] = "deno check main.ts";
    },
    /Node-only/,
  ],
  [
    "additional first-party owner",
    (m) => {
      m.dependencies["@lapismd/agent-redaction"] = "^0.1.1";
    },
    /one qualified/,
  ],
  [
    "removed signature check",
    (m) => {
      delete m.scripts["registry:verify-signatures"];
    },
    /Expected values/,
  ],
])
  test(`${name} requires source qualification`, () => {
    const value = manifest();
    change(value);
    assert.throws(() => checkDependencyContract(value), reason);
  });
