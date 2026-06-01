import assert from "node:assert/strict";
import test from "node:test";

import {
  corsHeaders,
  onRequest,
  onRequestOptions,
} from "../../functions/_middleware.js";

test("CORS middleware responds to OPTIONS preflight", async () => {
  const response = await onRequestOptions();

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "GET, HEAD, OPTIONS",
  );
});

test("CORS middleware appends headers to static responses", async () => {
  const response = await onRequest({
    request: new Request("https://registry.example.test/v1/index.json"),
    next: async () =>
      new Response("{}", {
        headers: { "content-type": "application/json" },
      }),
  });

  assert.equal(await response.text(), "{}");
  assert.equal(response.headers.get("content-type"), "application/json");
  for (const [key, value] of Object.entries(corsHeaders)) {
    assert.equal(response.headers.get(key), value);
  }
});
