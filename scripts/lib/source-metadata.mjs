import { TextDecoder } from "node:util";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";

import { createAjv, formatAjvErrors, sha256 } from "./registry.mjs";

export const maxSourceMetadataBytes = 64 * 1024;
export const maxPluginMarkdownBytes = 256 * 1024;
export const maxPluginLogoBytes = 512 * 1024;
export const maxPluginGalleryBytes = 5 * 1024 * 1024;

const sourceSchemaId =
  "https://registry.lapis.md/schemas/plugin-source.schema.json";

export async function fetchPluginSourceMetadata({
  payload,
  fetchImpl = fetch,
  outputDir,
  assetOutputDir = outputDir ? new URL("../assets/", outputDir) : undefined,
  registryBaseUrl = "https://registry.lapis.md/v1/",
}) {
  const packageRoot = sourcePackageRoot(payload);
  const sourceBaseUrl = `https://raw.githubusercontent.com/${payload.repository}/${payload.sourceCommit}/${packageRoot ? `${packageRoot}/` : ""}`;
  const [source, packageJson, manifest] = await Promise.all([
    fetchJson(
      fetchImpl,
      `${sourceBaseUrl}registry.json`,
      maxSourceMetadataBytes,
    ),
    fetchJson(
      fetchImpl,
      `${sourceBaseUrl}package.json`,
      maxSourceMetadataBytes,
    ),
    fetchJson(
      fetchImpl,
      `${sourceBaseUrl}manifest.json`,
      maxSourceMetadataBytes,
    ),
  ]);

  await validatePluginSource(source);
  validateSourceOwnership({ payload, packageJson, manifest });
  validateFirstPartyMediaSource(payload, source);

  const contentEntries = await Promise.all(
    Object.entries(source.content).map(async ([kind, relativePath]) => {
      assertSafeMarkdownPath(relativePath);
      const sourceUrl = new URL(relativePath, sourceBaseUrl).href;
      const bytes = await fetchBytes(
        fetchImpl,
        sourceUrl,
        maxPluginMarkdownBytes,
      );
      decodeUtf8(bytes, `${payload.pluginId} ${kind}`);
      const fileName = `${kind}.md`;
      if (outputDir) {
        const target = new URL(`${payload.pluginId}/${fileName}`, outputDir);
        await mkdir(new URL("./", target), { recursive: true });
        await writeFile(target, bytes);
      }
      return [
        kind,
        {
          url: new URL(
            `content/${payload.pluginId}/${fileName}`,
            registryBaseUrl,
          ).href,
          sourceUrl,
          sha256: sha256(bytes),
          size: bytes.byteLength,
          mediaType: "text/markdown",
        },
      ];
    }),
  );

  const repositoryUrl = `https://github.com/${payload.repository}`;
  const appearance = source.appearance
    ? await resolveSourceAppearance({
        appearance: source.appearance,
        fetchImpl,
        sourceBaseUrl,
        assetOutputDir,
        registryBaseUrl,
        pluginId: payload.pluginId,
      })
    : undefined;
  const gallery = source.gallery
    ? await resolveSourceGallery({
        gallery: source.gallery,
        fetchImpl,
        sourceBaseUrl,
        assetOutputDir,
        registryBaseUrl,
        pluginId: payload.pluginId,
      })
    : undefined;
  await pruneMirroredAssets(
    assetOutputDir,
    payload.pluginId,
    [appearance?.logo, ...(gallery ?? [])].filter(Boolean),
  );
  const links = compactObject({
    homepage: normalizeHttpsUrl(packageJson.homepage, "package homepage"),
    repository: normalizeRepositoryUrl(packageJson.repository),
    documentation: normalizeHttpsUrl(
      source.documentationUrl,
      "documentation URL",
    ),
    issues: normalizeHttpsUrl(
      typeof packageJson.bugs === "string"
        ? packageJson.bugs
        : packageJson.bugs?.url,
      "package issues URL",
    ),
  });

  return {
    name: manifest.name,
    description: manifest.description,
    author: normalizeAuthorName(manifest.author ?? packageJson.author),
    authorUrl:
      normalizeAuthorUrl(manifest.author ?? packageJson.author) ??
      repositoryUrl.split("/").slice(0, 4).join("/"),
    minAppVersion:
      manifest.minAppVersion ?? manifest.lapis?.compatibility?.minAppVersion,
    platforms:
      manifest.platforms ??
      manifest.lapis?.compatibility?.platforms ??
      (manifest.isDesktopOnly ? ["electron"] : ["web", "electron"]),
    categories: source.categories,
    highlights: source.highlights,
    ...(appearance ? { appearance } : {}),
    ...(gallery ? { gallery } : {}),
    license: packageJson.license,
    links,
    content: Object.fromEntries(contentEntries),
    readmeUrl: Object.fromEntries(contentEntries).overview?.sourceUrl,
    source: {
      repository: payload.repository,
      packageName: payload.packageName,
      sourceCommit: payload.sourceCommit,
      metadataPath: packageRoot
        ? `${packageRoot}/registry.json`
        : "registry.json",
    },
  };
}

export function applyPluginSourceMetadata(entry, metadata) {
  const { appearance: _appearance, gallery: _gallery, ...baseEntry } = entry;
  return {
    ...baseEntry,
    name: metadata.name,
    description: metadata.description,
    readmeUrl: metadata.readmeUrl,
    author: metadata.author,
    authorUrl: metadata.authorUrl,
    minAppVersion: metadata.minAppVersion ?? entry.minAppVersion,
    platforms: metadata.platforms,
    categories: metadata.categories,
    owner: {
      ...entry.owner,
      ...(metadata.links.repository ? { url: metadata.links.repository } : {}),
    },
    source: {
      ...entry.source,
      ...metadata.source,
    },
    license: metadata.license,
    links: metadata.links,
    highlights: metadata.highlights,
    content: metadata.content,
    ...(metadata.appearance ? { appearance: metadata.appearance } : {}),
    ...(metadata.gallery ? { gallery: metadata.gallery } : {}),
    readme: metadata.content.overview
      ? {
          url: metadata.content.overview.url,
          sha256: metadata.content.overview.sha256,
          size: metadata.content.overview.size,
        }
      : entry.readme,
  };
}

export async function validatePluginSource(source) {
  const ajv = await createAjv();
  const validate = ajv.getSchema(sourceSchemaId);
  if (!validate(source)) {
    throw new Error(`Invalid registry.json: ${formatAjvErrors(validate)}.`);
  }
}

export function validateSourceOwnership({ payload, packageJson, manifest }) {
  if (packageJson.name !== payload.packageName) {
    throw new Error(
      `${payload.pluginId}: package.json name does not match dispatch package.`,
    );
  }
  if (manifest.id !== payload.pluginId) {
    throw new Error(
      `${payload.pluginId}: manifest id does not match dispatch plugin.`,
    );
  }
  if (manifest.version !== packageJson.version) {
    throw new Error(
      `${payload.pluginId}: manifest and package versions do not match.`,
    );
  }
  if (payload.version && manifest.version !== payload.version) {
    throw new Error(
      `${payload.pluginId}: source metadata version does not match dispatch release.`,
    );
  }
  const packageRepository = normalizeRepositorySlug(packageJson.repository);
  if (packageRepository !== payload.repository) {
    throw new Error(
      `${payload.pluginId}: package repository does not match dispatch repository.`,
    );
  }
}

export function assertSafeMarkdownPath(value) {
  if (
    typeof value !== "string" ||
    !value.endsWith(".md") ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe plugin Markdown path: ${String(value)}.`);
  }
}

export function assertSafeAssetPath(value) {
  if (
    typeof value !== "string" ||
    !/^registry-assets\/[A-Za-z0-9._/-]+\.(?:png|webp|svg)$/.test(value) ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe plugin asset path: ${String(value)}.`);
  }
}

function validateFirstPartyMediaSource(payload, source) {
  if (payload.repository !== "lapismd/lapis-plugins") return;
  if (!source.appearance) {
    throw new Error(
      `${payload.pluginId}: first-party registry metadata requires appearance.`,
    );
  }
  if (!source.gallery?.some((item) => item.surface === "desktop")) {
    throw new Error(
      `${payload.pluginId}: first-party registry metadata requires a desktop gallery image.`,
    );
  }
  for (const item of source.gallery) {
    if (!item.capture?.storyId) {
      throw new Error(
        `${payload.pluginId}: first-party gallery images require a Storybook capture.`,
      );
    }
  }
}

async function resolveSourceAppearance(options) {
  const { appearance } = options;
  const logo = appearance.logo
    ? await resolveSourceImage({
        ...options,
        sourceAsset: appearance.logo,
        maxBytes: maxPluginLogoBytes,
        role: "logo",
        allowSvg: true,
      })
    : undefined;
  return {
    icon: appearance.icon,
    accent: appearance.accent.toUpperCase(),
    ...(logo ? { logo: { ...logo, alt: appearance.logo.alt } } : {}),
  };
}

async function resolveSourceGallery(options) {
  const ids = new Set();
  const surfaceCounts = { desktop: 0, mobile: 0 };
  for (const item of options.gallery) {
    if (ids.has(item.id)) {
      throw new Error(`${options.pluginId}: duplicate gallery id ${item.id}.`);
    }
    ids.add(item.id);
    surfaceCounts[item.surface] += 1;
    if (surfaceCounts[item.surface] > 5) {
      throw new Error(
        `${options.pluginId}: gallery permits at most five ${item.surface} images.`,
      );
    }
  }
  return Promise.all(
    options.gallery.map(async (item) => {
      const image = await resolveSourceImage({
        ...options,
        sourceAsset: item,
        maxBytes: maxPluginGalleryBytes,
        role: `${item.surface} gallery image`,
        allowSvg: false,
        expectedDimensions:
          item.surface === "desktop"
            ? { width: 1200, height: 800 }
            : { width: 900, height: 1600 },
      });
      return {
        id: item.id,
        surface: item.surface,
        alt: item.alt,
        ...(item.caption ? { caption: item.caption } : {}),
        ...image,
      };
    }),
  );
}

async function resolveSourceImage({
  sourceAsset,
  fetchImpl,
  sourceBaseUrl,
  assetOutputDir,
  registryBaseUrl,
  pluginId,
  maxBytes,
  role,
  allowSvg,
  expectedDimensions,
}) {
  assertSafeAssetPath(sourceAsset.path);
  const sourceUrl = new URL(sourceAsset.path, sourceBaseUrl).href;
  const bytes = await fetchBytes(fetchImpl, sourceUrl, maxBytes);
  if (sourceAsset.path.endsWith(".svg")) assertSafeSvg(bytes, sourceUrl);
  const metadata = await sharp(bytes, {
    limitInputPixels: 20_000_000,
    failOn: "warning",
  }).metadata();
  const expectedFormat = sourceAsset.path.split(".").at(-1);
  const actualFormat = metadata.format === "jpeg" ? "jpg" : metadata.format;
  if (actualFormat !== expectedFormat) {
    throw new Error(`${sourceUrl}: extension does not match image content.`);
  }
  if (metadata.format === "svg" && !allowSvg) {
    throw new Error(`${sourceUrl}: SVG is not permitted for ${role}.`);
  }
  const width = metadata.width;
  const height = metadata.height;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`${sourceUrl}: image dimensions are unavailable.`);
  }
  if (role === "logo" && (width !== height || width < 64 || width > 1024)) {
    throw new Error(
      `${sourceUrl}: logo must be square and between 64 and 1024 pixels.`,
    );
  }
  if (
    expectedDimensions &&
    (width !== expectedDimensions.width || height !== expectedDimensions.height)
  ) {
    throw new Error(
      `${sourceUrl}: ${role} must be ${expectedDimensions.width}x${expectedDimensions.height}.`,
    );
  }
  const digest = sha256(bytes);
  const extension = metadata.format === "svg" ? "svg" : metadata.format;
  const fileName = `${digest}.${extension}`;
  if (assetOutputDir) {
    const target = new URL(`${pluginId}/${fileName}`, assetOutputDir);
    await mkdir(new URL("./", target), { recursive: true });
    await writeFile(target, bytes);
  }
  return {
    url: new URL(`assets/${pluginId}/${fileName}`, registryBaseUrl).href,
    sourceUrl,
    sha256: digest,
    size: bytes.byteLength,
    mediaType:
      metadata.format === "svg" ? "image/svg+xml" : `image/${metadata.format}`,
    width,
    height,
  };
}

function assertSafeSvg(bytes, sourceUrl) {
  const source = decodeUtf8(bytes, sourceUrl);
  const unsafe = [
    /<script\b/i,
    /<foreignObject\b/i,
    /<!DOCTYPE\b/i,
    /<!ENTITY\b/i,
    /\bon[a-z]+\s*=/i,
    /(?:href|xlink:href)\s*=\s*["'](?!#)/i,
    /url\s*\(\s*["']?(?!#)/i,
    /@import\b/i,
    /\bdata:/i,
  ];
  if (
    !/<svg\b/i.test(source) ||
    unsafe.some((pattern) => pattern.test(source))
  ) {
    throw new Error(
      `${sourceUrl}: SVG contains unsupported or unsafe content.`,
    );
  }
}

async function pruneMirroredAssets(assetOutputDir, pluginId, references) {
  if (!assetOutputDir) return;
  const pluginDir = new URL(`${pluginId}/`, assetOutputDir);
  let files;
  try {
    files = await readdir(pluginDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const expected = new Set(
    references.map((reference) =>
      new URL(reference.url).pathname.split("/").at(-1),
    ),
  );
  await Promise.all(
    files
      .filter((entry) => entry.isFile() && !expected.has(entry.name))
      .map((entry) => rm(new URL(entry.name, pluginDir))),
  );
}

function sourcePackageRoot(payload) {
  if (payload.repository === "lapismd/lapis-plugins") {
    return `packages/${payload.packageName.split("/")[1]}`;
  }
  return "";
}

async function fetchJson(fetchImpl, url, limit) {
  const bytes = await fetchBytes(fetchImpl, url, limit);
  const text = decodeUtf8(bytes, url);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${url}: invalid JSON.`, { cause: error });
  }
}

async function fetchBytes(fetchImpl, url, limit) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/vnd.github.raw+json" },
  });
  if (!response.ok) {
    throw new Error(`Source request failed: ${url} HTTP ${response.status}.`);
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error(`${url}: source file exceeds ${limit} bytes.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > limit) {
    throw new Error(`${url}: source file exceeds ${limit} bytes.`);
  }
  return bytes;
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label}: source file is not valid UTF-8.`, {
      cause: error,
    });
  }
}

function normalizeRepositorySlug(repository) {
  const value =
    typeof repository === "string" ? repository : (repository?.url ?? "");
  return value
    .replace(/^github:/, "")
    .replace(/^git\+https:\/\/github\.com\//, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function normalizeRepositoryUrl(repository) {
  const slug = normalizeRepositorySlug(repository);
  return slug
    ? normalizeHttpsUrl(`https://github.com/${slug}`, "repository")
    : undefined;
}

function normalizeHttpsUrl(value, label) {
  if (!value) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`${label} must be a valid HTTPS URL.`, { cause: error });
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  return parsed.href;
}

function normalizeAuthorName(author) {
  if (typeof author === "string" && author.trim()) return author.trim();
  if (author?.name?.trim()) return author.name.trim();
  return "Lapis Notes";
}

function normalizeAuthorUrl(author) {
  if (typeof author === "object") {
    return normalizeHttpsUrl(author.url, "author URL");
  }
  return undefined;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}
