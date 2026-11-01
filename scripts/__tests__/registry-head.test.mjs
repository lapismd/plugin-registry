import assert from "node:assert/strict";
import test from "node:test";
import { waitForPrHead } from "../lib/registry-head.mjs";
import { LeaseConflict } from "../lib/registry-refresh.mjs";

test("leased pushes wait for PR head visibility without accepting competing changes", async () => {
  const pr = (sha, state = "open", body = "request") => ({
    state,
    head: { sha },
    body,
  });
  let reads = 0,
    waits = 0;
  const options = {
    expectedHead: "new",
    previousHead: "old",
    isExpected: (value) => value.body === "request",
    sleep: async (ms) => {
      assert.equal(ms, 1000);
      waits++;
    },
  };
  const client = {
    call: async (path) => {
      assert.equal(path, "/repos/lapismd/plugin-registry/pulls/55");
      return pr(++reads < 3 ? "old" : "new");
    },
  };
  assert.equal((await waitForPrHead(client, 55, options)).head.sha, "new");
  assert.equal(reads, 3);
  assert.equal(waits, 2);
  for (const value of [
    pr("human-head"),
    pr("new", "closed"),
    pr("new", "open", "changed request"),
  ]) {
    await assert.rejects(
      waitForPrHead({ call: async () => value }, 55, options),
      LeaseConflict,
    );
  }
  reads = 0;
  waits = 0;
  await assert.rejects(
    waitForPrHead(
      {
        call: async () => {
          reads++;
          return pr("old");
        },
      },
      55,
      options,
    ),
    /not visible/,
  );
  assert.equal(reads, 20);
  assert.equal(waits, 19);
  assert.equal(
    (
      await waitForPrHead({ call: async () => pr("new") }, 55, {
        ...options,
        previousHead: "new",
      })
    ).head.sha,
    "new",
  );
});
