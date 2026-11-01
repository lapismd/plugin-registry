#!/usr/bin/env node
import {
  loadSubmissions,
  verifySubmission,
} from "./lib/registry-submissions.mjs";

const records = await loadSubmissions();
if (process.argv.includes("--verify")) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, records.length) }, async () => {
      while (next < records.length) {
        const record = records[next++];
        await verifySubmission(record);
        console.log(`Verified ${record.file}`);
      }
    }),
  );
}
console.log(`Validated ${records.length} queued registry submission(s).`);
