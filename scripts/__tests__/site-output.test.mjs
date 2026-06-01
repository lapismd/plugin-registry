import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const dist = new URL("../../dist/", import.meta.url);

test("site build emits pages and registry metadata", async () => {
  if (!existsSync(new URL("index.html", dist))) {
    const result = spawnSync("pnpm", ["site:build"], {
      cwd: root.pathname,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    assert.equal(result.status, 0);
  }

  const requiredFiles = [
    "index.html",
    "plugins/index.html",
    "plugins/lapis-docs/index.html",
    "v1/index.json",
    "v1/index.sig",
    "v1/plugins/lapis-docs.json",
    "v1/plugins/lapis-docs.sig",
    "v1/trust/root.json",
  ];

  for (const file of requiredFiles) {
    assert.equal(existsSync(new URL(file, dist)), true, `${file} should exist`);
  }

  const detail = await readFile(
    new URL("plugins/lapis-docs/index.html", dist),
    "utf8",
  );
  assert.match(detail, /Signed manifest/);
  assert.match(detail, /\*\.lapisdoc/);
});
