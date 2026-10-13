import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { downloadTargets } from "../../generated/download-targets.mjs";
import { releaseDownloadAvailable } from "../../scripts/lib/registry.mjs";
// The site and registry automation intentionally share one safe Markdown renderer.
import { renderMarkdownToSafeHtml } from "../../scripts/lib/readmes.mjs";

import {
  normalizeRegistryCatalogIndex,
  normalizeRegistryCatalogDetail,
  resolveRegistryMedia,
  type RegistryCatalogV2Entry,
  type RegistryCatalogV2Detail,
  type RegistryReleaseV2,
  type RegistryMediaV2,
} from "@lapis-notes/api/registry/schema";
export const officialAuthorAvatarUrl =
  "https://www.gravatar.com/avatar/1df68d9ff087b0dd72fd8626056fca7f?s=128&d=404";
export type PluginImageReference = ReturnType<typeof resolveRegistryMedia>;
export type PluginMediaItem = {
  alt: string;
  images: Record<"preview" | "full" | "light" | "dark", PluginImageReference>;
};
export type PluginGalleryItem = PluginMediaItem & { id: string };
export type PluginAppearance = {
  icon: string;
  accent: string;
  logo?: PluginImageReference & { alt: string };
};
export type RegistryPluginSummary = Omit<
  RegistryCatalogV2Entry,
  "appearance"
> & { appearance?: PluginAppearance };
export type RegistryIndex = {
  schemaVersion: 2;
  generatedAt: string;
  plugins: RegistryPluginSummary[];
};
export type PluginContributions = RegistryCatalogV2Entry["contributes"];
export type PluginVersion = RegistryReleaseV2;
export type PluginLinks = RegistryCatalogV2Detail["links"];
export type PluginDetail = Omit<
  RegistryCatalogV2Detail,
  "appearance" | "media" | "gallery"
> & {
  appearance?: PluginAppearance;
  media?: { banner?: PluginMediaItem; overview?: PluginMediaItem };
  gallery?: PluginGalleryItem[];
};
function displayMedia(item: RegistryMediaV2): PluginMediaItem {
  return {
    alt: item.alt,
    images: {
      preview: resolveRegistryMedia(item, "preview"),
      full: resolveRegistryMedia(item, "full"),
      light: resolveRegistryMedia(item, "light"),
      dark: resolveRegistryMedia(item, "dark"),
    },
  };
}
function displayAppearance(
  appearance: RegistryCatalogV2Detail["appearance"],
): PluginAppearance | undefined {
  return appearance
    ? {
        icon: appearance.icon,
        accent: appearance.accent,
        ...(appearance.logo
          ? {
              logo: {
                ...resolveRegistryMedia(appearance.logo),
                alt: appearance.logo.alt,
              },
            }
          : {}),
      }
    : undefined;
}
function displayDetail(value: unknown): PluginDetail {
  const detail = normalizeRegistryCatalogDetail(value);
  return {
    ...detail,
    appearance: displayAppearance(detail.appearance),
    media: {
      ...(detail.media?.banner
        ? { banner: displayMedia(detail.media.banner) }
        : {}),
      ...(detail.media?.overview
        ? { overview: displayMedia(detail.media.overview) }
        : {}),
    },
    gallery: detail.gallery?.map((item) => ({
      id: item.id,
      ...displayMedia(item),
    })),
  };
}

export interface PluginMarkdownReference {
  url: string;
  sourceUrl: string;
  sha256: string;
  size: number;
  mediaType: "text/markdown";
}

export interface PluginCatalogContent {
  overview?: PluginMarkdownReference;
  changelog?: PluginMarkdownReference;
}

export interface SitePlugin
  extends Omit<RegistryPluginSummary, "latestRelease"> {
  detailData: PluginDetail;
  searchText: string;
  filePatterns: string[];
  latestRelease: PluginVersion;
  firstReleasedAt: string;
}

const registryRoot =
  process.env.LAPIS_REGISTRY_DATA_DIR ??
  process.env.LAPIS_REGISTRY_DATA_V1_DIR ??
  path.join(process.cwd(), "generated", "v2");
const siteRegistryRoot =
  process.env.LAPIS_REGISTRY_SITE_DIR ??
  process.env.LAPIS_REGISTRY_SITE_V1_DIR ??
  path.join(process.cwd(), "dist", "v2");

export async function getRegistrySiteData() {
  const canonicalIndex = normalizeRegistryCatalogIndex(
    await readJson<unknown>("index.json"),
  );
  const index: RegistryIndex = {
    ...canonicalIndex,
    plugins: canonicalIndex.plugins.map((entry) => ({
      ...entry,
      appearance: displayAppearance(entry.appearance),
    })),
  };
  const plugins = await Promise.all(
    index.plugins.map(async (plugin) => {
      const detail = displayDetail(await readJson<unknown>(plugin.detail));
      const latestRelease = detail.versions[detail.latestVersion];
      if (!latestRelease) {
        throw new Error(
          `${plugin.id}: missing latest release ${detail.latestVersion}`,
        );
      }
      const filePatterns = collectFilePatterns(
        plugin.contributes ?? detail.contributes,
      );
      const firstReleasedAt = Object.values(detail.versions)
        .map((release) => release.releasedAt)
        .sort()[0];
      const searchText = [
        plugin.name,
        plugin.description,
        plugin.author,
        plugin.id,
        ...plugin.categories,
        ...plugin.platforms,
        ...filePatterns,
      ]
        .join(" ")
        .toLowerCase();
      return {
        ...plugin,
        appearance: detail.appearance ?? plugin.appearance,
        detailData: detail,
        filePatterns,
        firstReleasedAt,
        latestRelease,
        searchText,
      };
    }),
  );

  const sortedPlugins = plugins.sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: index.generatedAt,
    plugins: sortedPlugins,
    categories: collectCategories(sortedPlugins),
  };
}

export function collectCategories(plugins: SitePlugin[]) {
  const counts = new Map<string, number>();
  for (const plugin of plugins) {
    for (const category of plugin.categories) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: titleCase(id), count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function relatedPlugins(plugin: SitePlugin, plugins: SitePlugin[]) {
  const categories = new Set(plugin.categories);
  return plugins
    .filter((candidate) => candidate.id !== plugin.id)
    .map((candidate) => ({
      plugin: candidate,
      score: candidate.categories.filter((category) => categories.has(category))
        .length,
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.plugin.name.localeCompare(b.plugin.name),
    )
    .slice(0, 6)
    .map((entry) => entry.plugin);
}

export async function readGeneratedReadmeHtml(pluginId: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginId)) return null;
  try {
    return await readFile(
      path.join(siteRegistryRoot, "readmes", pluginId, "README.html"),
      "utf8",
    );
  } catch {
    return null;
  }
}

export async function readStructuredMarkdownHtml(
  pluginId: string,
  kind: keyof PluginCatalogContent,
  reference?: PluginMarkdownReference,
) {
  if (!reference) return { html: null, error: null };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginId)) {
    return { html: null, error: "Invalid plugin content path." };
  }
  try {
    const bytes = await readFile(
      path.join(siteRegistryRoot, "content", pluginId, `${kind}.md`),
    );
    if (bytes.byteLength !== reference.size) {
      return {
        html: null,
        error: "Mirrored content size does not match signed metadata.",
      };
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== reference.sha256) {
      return {
        html: null,
        error: "Mirrored content hash does not match signed metadata.",
      };
    }
    return {
      html: renderMarkdownToSafeHtml(bytes.toString("utf8")),
      error: null,
    };
  } catch (error) {
    return {
      html: null,
      error: error instanceof Error ? error.message : "Content is unavailable.",
    };
  }
}

export function statusLabel(status: SitePlugin["status"]) {
  if (status === "pending") {
    return "Coming soon";
  }
  if (status === "revoked") {
    return "Revoked";
  }
  return "Available";
}

export function titleCase(value: string) {
  const initialisms = new Map([["ai", "AI"]]);
  return value
    .split("-")
    .map(
      (part) =>
        initialisms.get(part.toLowerCase()) ??
        part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

export function formatBytes(size: number) {
  if (!Number.isFinite(size) || size < 0) {
    return "Unknown size";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units.at(-1)) {
      return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${size} B`;
}

export function pluginDownloadHref(release: PluginVersion) {
  if (!release.bundle.downloadUrl) return release.bundle.url;
  try {
    const endpoint = new URL(
      release.bundle.downloadUrl,
      "https://registry.lapis.md/v2/plugins/plugin.json",
    );
    if (!endpoint.pathname.startsWith("/download/")) return release.bundle.url;
    endpoint.searchParams.set("action", "download");
    endpoint.searchParams.set("platform", "web");
    endpoint.searchParams.set("os", "unknown");
    return `${endpoint.pathname}${endpoint.search}`;
  } catch {
    return release.bundle.url;
  }
}

export function pluginReleaseAvailable(
  plugin: SitePlugin,
  release: PluginVersion,
) {
  const targets = downloadTargets.targets as Record<
    string,
    { status: string; originUrl: string }
  >;
  const target = targets[`${plugin.id}@${release.version}`];
  return releaseDownloadAvailable(plugin.status, release, target);
}

function collectFilePatterns(contributes: PluginContributions) {
  return (
    contributes?.editorViews?.flatMap((view) => view.filenamePatterns ?? []) ??
    []
  ).sort();
}

async function readJson<T>(relativePath: string): Promise<T> {
  const filePath = path.join(registryRoot, relativePath);
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
