import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Display the published source snapshot's commit time, independently of the
// fixed timestamps used to reproduce signed registry metadata.
export function registryUpdatedAt() {
  let value = process.env.LAPIS_REGISTRY_UPDATED_AT;
  if (!value) {
    try {
      value = execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  }
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()))
    throw new Error("Invalid registry update timestamp");
  return {
    datetime: date.toISOString(),
    label: `${new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date)} UTC`,
  };
}
