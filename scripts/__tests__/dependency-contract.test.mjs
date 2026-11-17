import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkDependencyContract } from "../check-dependency-contract.mjs";

const manifest = () =>
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url)));

test("current registry retains private signed-deployment authority", () => {
  const result = checkDependencyContract(manifest());
  assert.equal(result.versionIntent, false);
  assert.equal(result.dependency.name, "@lapis-notes/api");
});

test("a future compatible API patch retains the no-version contract", () => {
  const value = manifest();
  value.dependencies["@lapis-notes/api"] = "^0.1.999";
  assert.equal(checkDependencyContract(value).versionIntent, false);
});

for (const range of [
  "^0.1.1",
  "^0.2.0",
  "^1.0.0",
  "*",
  "catalog:",
  "file:../api",
  "^0.1.3-next.0",
])
  test(`unsupported API boundary remains held: ${range}`, () => {
    const value = manifest();
    value.dependencies["@lapis-notes/api"] = range;
    assert.throws(
      () => checkDependencyContract(value),
      /qualified 0.1 patches/,
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
