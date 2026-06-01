import { readFile } from "node:fs/promises";
import path from "node:path";

export interface RegistryIndex {
  schemaVersion: 1;
  generatedAt: string;
  plugins: RegistryPluginSummary[];
}

export interface RegistryPluginSummary {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  readmeUrl?: string;
  author: string;
  authorUrl?: string;
  channel: "official" | "community";
  status: "active" | "pending" | "revoked";
  latestVersion: string;
  minAppVersion: string;
  platforms: string[];
  categories: string[];
  badges: string[];
  owner: {
    name: string;
    verified: boolean;
  };
  detail: string;
  contributes?: PluginContributions;
}

export interface PluginContributions {
  editorViews?: Array<{
    id: string;
    label?: string;
    filenamePatterns: string[];
  }>;
}

export interface PluginVersion {
  version: string;
  minAppVersion: string;
  releasedAt: string;
  platforms: string[];
  releaseManifest: {
    url: string;
    sha256: string;
    size: number;
    pending?: boolean;
  };
  files: Array<{
    path: string;
    url: string;
    sha256: string;
    size: number;
    optional?: boolean;
    pending?: boolean;
  }>;
}

export interface PluginDetail {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  readmeUrl?: string;
  channel: "official" | "community";
  status: "active" | "pending" | "revoked";
  owner: {
    name: string;
    verified: boolean;
  };
  latestVersion: string;
  contributes?: PluginContributions;
  versions: Record<string, PluginVersion>;
}

export interface SitePlugin extends RegistryPluginSummary {
  detailData: PluginDetail;
  searchText: string;
  filePatterns: string[];
  latestRelease: PluginVersion;
}

const registryRoot = path.join(process.cwd(), "generated", "v1");

export async function getRegistrySiteData() {
  const index = await readJson<RegistryIndex>("index.json");
  const plugins = await Promise.all(
    index.plugins.map(async (plugin) => {
      const detail = await readJson<PluginDetail>(plugin.detail);
      const latestRelease = detail.versions[detail.latestVersion];
      if (!latestRelease) {
        throw new Error(
          `${plugin.id}: missing latest release ${detail.latestVersion}`,
        );
      }
      const filePatterns = collectFilePatterns(
        plugin.contributes ?? detail.contributes,
      );
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
        detailData: detail,
        filePatterns,
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
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function collectFilePatterns(contributes?: PluginContributions) {
  return (
    contributes?.editorViews?.flatMap((view) => view.filenamePatterns) ?? []
  ).sort();
}

async function readJson<T>(relativePath: string): Promise<T> {
  const filePath = path.join(registryRoot, relativePath);
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
