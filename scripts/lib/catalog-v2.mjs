import {
  normalizeRegistryCatalogDetail,
  normalizeRegistryCatalogEntry,
} from "@lapismd/lapis-community/registry/schema";
import { buildRegistry } from "./registry.mjs";

export function buildRegistryV2(entries) {
  const legacy = buildRegistry(entries);
  const details = Object.fromEntries(
    entries.map((entry) => {
      const detail = normalizeRegistryCatalogDetail({
        ...legacy.details[entry.id],
        author: entry.author,
        authorUrl: entry.authorUrl,
        authorAvatarUrl: entry.authorAvatarUrl,
        media: entry.media,
      });
      return [entry.id, detail];
    }),
  );
  const plugins = legacy.index.plugins.map((entry) => {
    const release = details[entry.id].versions[entry.latestVersion];
    return normalizeRegistryCatalogEntry({
      ...entry,
      minAppVersion: release.minAppVersion,
      platforms: release.platforms,
    });
  });
  return {
    ...legacy,
    index: { schemaVersion: 2, generatedAt: legacy.index.generatedAt, plugins },
    details,
  };
}
