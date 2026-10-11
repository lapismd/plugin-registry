import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { generatedAt } from "./registry.mjs";

/** Unpublished source packages are visible only in the unsigned local overlay. */
export async function pendingLocalSourceEntries(sourceRoot, entries) {
  let directories;
  try {
    directories = await readdir(path.join(sourceRoot, "packages"), {
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const knownIds = new Set(entries.map((entry) => entry.id));
  const pending = [];
  for (const directory of directories
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const packageRoot = path.join(sourceRoot, "packages", directory.name);
    let manifest, packageJson;
    try {
      await readFile(path.join(packageRoot, "registry.json"));
      manifest = JSON.parse(
        await readFile(path.join(packageRoot, "manifest.json"), "utf8"),
      );
      packageJson = JSON.parse(
        await readFile(path.join(packageRoot, "package.json"), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (knownIds.has(manifest.id)) continue;
    const repository =
      typeof packageJson.repository === "string"
        ? packageJson.repository
        : packageJson.repository?.url;
    if (!repository?.includes("github.com/lapismd/lapis-plugins")) continue;
    const platforms = manifest.isDesktopOnly ? ["desktop"] : ["web", "desktop"];
    const minAppVersion = manifest.minAppVersion ?? "0.1.0";
    const bundle = {
      url: `https://registry.lapis.md/local-source-preview/${manifest.id}.lapis-plugin`,
      sha256: "0".repeat(64),
      size: 0,
      pending: true,
    };
    pending.push({
      schemaVersion: 1,
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      author:
        typeof manifest.author === "string"
          ? manifest.author
          : (manifest.author?.name ?? "Lapis Notes"),
      channel: "official",
      status: "pending",
      owner: { name: "Lapis Notes", verified: true },
      latestVersion: manifest.version,
      minAppVersion,
      platforms,
      categories: [],
      source: {
        repository: "lapismd/lapis-plugins",
        packageName: packageJson.name,
      },
      versions: {
        [manifest.version]: {
          version: manifest.version,
          minAppVersion,
          platforms,
          releasedAt: generatedAt,
          bundle,
        },
      },
    });
  }
  return pending;
}
