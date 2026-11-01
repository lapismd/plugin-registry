import { registryRepository } from "./registry-request.mjs";
import { LeaseConflict } from "./registry-refresh.mjs";
import { setTimeout as delay } from "node:timers/promises";

export async function waitForPrHead(
  client,
  number,
  { expectedHead, previousHead, isExpected = () => true, sleep = delay } = {},
) {
  // Git's leased push can become visible before the pull-request API updates.
  for (let attempt = 0; attempt < 20; attempt++) {
    const pr = await client.call(
      `/repos/${registryRepository}/pulls/${number}`,
    );
    if (pr.state !== "open" || !isExpected(pr))
      throw new LeaseConflict(
        `PR #${number} changed state or request before description update.`,
      );
    if (pr.head.sha === expectedHead) return pr;
    if (pr.head.sha !== previousHead)
      throw new LeaseConflict(
        `PR #${number} has a competing head before description update.`,
      );
    if (attempt < 19) await sleep(1000);
  }
  throw new LeaseConflict(
    `PR #${number}: pushed head is not visible through the PR API yet.`,
  );
}
