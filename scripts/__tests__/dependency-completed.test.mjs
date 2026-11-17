import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pin = "053ac8be573871ccc5b0232bc91d8ce7f3bff02f";
const source = () =>
  readFileSync(
    new URL(
      "../../.github/workflows/dependency-completed.yml",
      import.meta.url,
    ),
    "utf8",
  );

test("completion source observes only the registered validation and deployment", () => {
  const text = source();
  assert.match(text, /^name: Notify dependency completion$/m);
  const names = [...text.matchAll(/^      - (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(names, ["Checks", "Publish registry"]);
  assert.match(text, /^    types: \[completed\]$/m);
  assert.match(
    text,
    new RegExp(
      `^    uses: lapismd/dependency-automation/\\.github/workflows/completion\\.yml@${pin}$`,
      "m",
    ),
  );
  assert.match(text, new RegExp(`^      automation-ref: ${pin}$`, "m"));
  assert.match(
    text,
    /^    if: github\.event\.workflow_run\.conclusion == 'success'$/m,
  );
});

test("completion cannot run candidate code, inherit registry authority or recurse", () => {
  const text = source();
  const permissions = text
    .split(/^permissions:\s*$/m)[1]
    .split(/^jobs:\s*$/m)[0];
  assert.deepEqual(
    permissions
      .trim()
      .split("\n")
      .map((s) => s.trim()),
    ["contents: read", "actions: read", "pull-requests: read"],
  );
  assert.deepEqual(
    [...text.split(/^jobs:\s*$/m)[1].matchAll(/^  ([\w-]+):/gm)].map(
      (m) => m[1],
    ),
    ["notify"],
  );
  assert.match(
    text,
    /^      app-private-key: \$\{\{ secrets\.LAPIS_DEPENDENCY_APP_PRIVATE_KEY \}\}$/m,
  );
  assert.equal((text.match(/secrets\./g) ?? []).length, 1);
  assert.doesNotMatch(
    text,
    /: write|secrets: inherit|concurrency:|cancel-in-progress:|runs-on:|steps:|container:|\brun:|checkout@|download-artifact@|cache@|pull_request_target|workflow_dispatch:/,
  );
  assert.doesNotMatch(
    text,
    /REGISTRY_APP|REGISTRY_PRIVATE|Sync plugin release|Prepare registry publication|Publish qualified registry candidate|Publish download statistics|Sign registry metadata|      - Notify dependency completion/,
  );
});
