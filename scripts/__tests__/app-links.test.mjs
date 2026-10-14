import assert from "node:assert/strict";
import test from "node:test";
import { pluginAppHref } from "../lib/app-links.mjs";

test("plugin app links retain release coordinates without transporting an archive or trust root", () => {
  for (const version of ["0.1.1", "2026.6.6", "1.2.3-beta.1+build.9"]) {
    const url = new URL(pluginAppHref("lapis-source-editor", version));
    assert.equal(url.protocol, "lapis:");
    assert.equal(url.hostname, "plugins");
    assert.equal(url.searchParams.get("id"), "lapis-source-editor");
    assert.equal(url.searchParams.get("version"), version);
    assert.deepEqual([...url.searchParams.keys()], ["id", "version"]);
  }
  assert.equal(
    new URL(pluginAppHref("spellcheck", "0.1.1", "web+lapis")).protocol,
    "web+lapis:",
  );
  assert.throws(
    () => pluginAppHref("spellcheck", "0.1.1", "https"),
    /Unsupported/,
  );
});
