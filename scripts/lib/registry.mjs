import {
  createHash,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "jsonc-parser";
import {
  assertSafePluginRelativePath,
  parsePluginBundle,
  pluginBundleReleaseManifestPath,
} from "./plugin-bundle.mjs";

export const repoRoot = new URL("../../", import.meta.url);
export const generatedDir = new URL("../../generated/v1/", import.meta.url);
export const downloadTargetsFile = new URL(
  "../../generated/download-targets.mjs",
  import.meta.url,
);
export const generatedAt = "2026-05-31T00:00:00.000Z";
export const pluginIdPattern = /^[a-z0-9][a-z0-9-]{1,62}$/;

export async function readJson(fileUrl) {
  return JSON.parse(await fs.readFile(fileUrl, "utf8"));
}

export async function writeJson(fileUrl, value) {
  await fs.mkdir(new URL("./", fileUrl), { recursive: true });
  await fs.writeFile(fileUrl, `${stableStringify(value, 2)}\n`);
}

export async function readJsonIfExists(fileUrl) {
  try {
    return await readJson(fileUrl);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readJsonc(fileUrl) {
  const source = await fs.readFile(fileUrl, "utf8");
  const errors = [];
  const value = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`${fileUrl.pathname}: invalid JSONC`);
  }
  return value;
}

export async function listFiles(dirUrl, predicate = () => true) {
  const entries = await fs.readdir(dirUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = new URL(entry.name, ensureSlash(dirUrl));
    if (entry.isDirectory()) {
      files.push(...(await listFiles(child, predicate)));
    } else if (predicate(child)) {
      files.push(child);
    }
  }
  return files.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

export function ensureSlash(fileUrl) {
  return new URL(
    fileUrl.pathname.endsWith("/") ? fileUrl.pathname : `${fileUrl.pathname}/`,
    fileUrl,
  );
}

export async function loadEntries() {
  const entriesDir = new URL("../../entries/", import.meta.url);
  const files = await listFiles(entriesDir, (file) =>
    file.pathname.endsWith(".jsonc"),
  );
  const entries = [];
  for (const file of files) {
    const entry = await readJsonc(file);
    entry.__sourcePath = path.relative(repoRoot.pathname, file.pathname);
    entries.push(entry);
  }
  return entries;
}

export async function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemaFiles = await listFiles(
    new URL("../../schemas/", import.meta.url),
    (file) => file.pathname.endsWith(".schema.json"),
  );
  for (const file of schemaFiles) {
    ajv.addSchema(await readJson(file));
  }
  return ajv;
}

export function formatAjvErrors(validate) {
  return (validate.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

export function validateEntryRules(entries) {
  const errors = [];
  const seen = new Map();
  for (const entry of entries) {
    if (!pluginIdPattern.test(entry.id)) {
      errors.push(`${entry.__sourcePath}: invalid plugin id ${entry.id}`);
    }
    const existing = seen.get(entry.id);
    if (existing) {
      errors.push(
        `${entry.__sourcePath}: duplicate plugin id ${entry.id}; first seen in ${existing}`,
      );
    }
    seen.set(entry.id, entry.__sourcePath);
    if (entry.channel === "official" && entry.owner?.verified !== true) {
      errors.push(
        `${entry.__sourcePath}: official entries must have a verified owner`,
      );
    }
    if (entry.channel === "community" && entry.badges?.includes("official")) {
      errors.push(
        `${entry.__sourcePath}: community entries cannot claim the official badge`,
      );
    }
    if (entry.readmeUrl && !entry.readmeUrl.startsWith("https://")) {
      errors.push(`${entry.__sourcePath}: readmeUrl must use HTTPS`);
    }
    if (!Object.hasOwn(entry.versions, entry.latestVersion)) {
      errors.push(
        `${entry.__sourcePath}: latestVersion must exist in versions`,
      );
    }
    for (const [version, release] of Object.entries(entry.versions)) {
      if (version !== release.version) {
        errors.push(
          `${entry.__sourcePath}: versions key ${version} does not match release version ${release.version}`,
        );
      }
      validateHttpsFile(errors, entry.__sourcePath, release.bundle);
    }
  }
  return errors;
}

export function validateHttpsFile(errors, sourcePath, file) {
  if (!file.url.startsWith("https://")) {
    errors.push(`${sourcePath}: URL must use HTTPS: ${file.url}`);
  }
  if (file.pending) {
    return;
  }
  if (file.sha256 === "0".repeat(64) || file.size === 0) {
    errors.push(
      `${sourcePath}: non-pending remote files must provide real sha256 and size`,
    );
  }
}

export async function validateRemoteAssets(
  entries,
  { strictRemote = false } = {},
) {
  const errors = [];
  const trustRoot = strictRemote ? await loadTrustRoot() : null;
  for (const entry of entries) {
    for (const release of Object.values(entry.versions)) {
      if (release.bundle.pending) {
        if (strictRemote) {
          errors.push(
            `${entry.__sourcePath}: pending plugin bundle cannot be published`,
          );
        }
        continue;
      }
      const bundle = await fetchHashedBytes(release.bundle);
      if (!bundle.ok) {
        errors.push(`${entry.__sourcePath}: ${bundle.error}`);
        continue;
      }
      let bundledFiles;
      try {
        bundledFiles = parsePluginBundle(bundle.bytes);
      } catch (error) {
        errors.push(`${entry.__sourcePath}: ${error.message}`);
        continue;
      }
      const signedReleaseBytes = bundledFiles.get(
        pluginBundleReleaseManifestPath,
      );
      const signed = JSON.parse(signedReleaseBytes.toString("utf8"));
      const releaseJson = signed.signed ?? signed;
      if (strictRemote && entry.channel === "official") {
        errors.push(
          ...verifyReleaseManifestSignature(signed, trustRoot).map(
            (message) => `${entry.__sourcePath}: ${message}`,
          ),
        );
      }
      if (releaseJson.pluginId !== entry.id) {
        errors.push(
          `${entry.__sourcePath}: release manifest pluginId mismatch`,
        );
      }
      if (releaseJson.version !== release.version) {
        errors.push(`${entry.__sourcePath}: release manifest version mismatch`);
      }
      const expectedPaths = new Set();
      for (const file of releaseJson.files ?? []) {
        try {
          assertSafePluginRelativePath(file.path);
        } catch (error) {
          errors.push(`${entry.__sourcePath}: ${error.message}`);
          continue;
        }
        expectedPaths.add(file.path);
        const bytes = bundledFiles.get(file.path);
        if (!bytes) {
          errors.push(`${entry.__sourcePath}: bundle is missing ${file.path}`);
          continue;
        }
        if (sha256(bytes) !== file.sha256) {
          errors.push(
            `${entry.__sourcePath}: sha256 mismatch for bundled file ${file.path}`,
          );
        }
        if (bytes.byteLength !== file.size) {
          errors.push(
            `${entry.__sourcePath}: size mismatch for bundled file ${file.path}`,
          );
        }
      }
      for (const entryPath of bundledFiles.keys()) {
        if (
          entryPath !== pluginBundleReleaseManifestPath &&
          !expectedPaths.has(entryPath)
        ) {
          errors.push(
            `${entry.__sourcePath}: unsigned bundled file ${entryPath}`,
          );
        }
      }
    }
  }
  return errors;
}

function verifyReleaseManifestSignature(envelope, trustRoot) {
  if (!envelope.signed || !Array.isArray(envelope.signatures)) {
    return ["official release manifest must be a signed envelope"];
  }
  const releaseKeyIds = new Set(trustRoot.roles?.release ?? []);
  const validSignature = envelope.signatures.some((signature) => {
    if (!releaseKeyIds.has(signature.keyId)) {
      return false;
    }
    try {
      return verifyJson(
        envelope.signed,
        signature,
        publicKeyFor(trustRoot, signature.keyId),
      );
    } catch {
      return false;
    }
  });
  return validSignature
    ? []
    : ["official release manifest does not have a valid release signature"];
}

async function fetchHashedBytes(file) {
  let response;
  try {
    response = await fetch(file.url);
  } catch (error) {
    return {
      ok: false,
      error: `failed to fetch ${file.url}: ${error.message}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `failed to fetch ${file.url}: HTTP ${response.status}`,
    };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== file.sha256) {
    return { ok: false, error: `sha256 mismatch for ${file.url}` };
  }
  if (bytes.byteLength !== file.size) {
    return { ok: false, error: `size mismatch for ${file.url}` };
  }
  return { ok: true, bytes };
}

export function buildRegistry(entries) {
  const normalized = entries
    .map((entry) => stripInternal(entry))
    .sort((a, b) => a.id.localeCompare(b.id));
  const indexPlugins = normalized.map((entry) => {
    const latestRelease = entry.versions[entry.latestVersion];
    return {
      schemaVersion: 1,
      id: entry.id,
      name: entry.name,
      description: entry.description,
      readmeUrl: entry.readmeUrl,
      author: entry.author,
      authorUrl: entry.authorUrl,
      channel: entry.channel,
      status: entry.status,
      latestVersion: entry.latestVersion,
      minAppVersion: entry.minAppVersion,
      platforms: entry.platforms,
      categories: entry.categories,
      badges: entry.badges ?? [],
      owner: entry.owner,
      latestRelease: {
        releasedAt: latestRelease.releasedAt,
        bundleSize: latestRelease.bundle.size,
      },
      detail: `plugins/${entry.id}.json`,
      contributes: entry.contributes ?? {},
    };
  });
  const details = Object.fromEntries(
    normalized.map((entry) => [
      entry.id,
      {
        schemaVersion: 1,
        id: entry.id,
        name: entry.name,
        description: entry.description,
        ...(entry.readmeUrl ? { readmeUrl: entry.readmeUrl } : {}),
        channel: entry.channel,
        status: entry.status,
        owner: entry.owner,
        latestVersion: entry.latestVersion,
        ...(entry.readme ? { readme: entry.readme } : {}),
        ...(entry.license ? { license: entry.license } : {}),
        ...(entry.links ? { links: entry.links } : {}),
        ...(entry.highlights ? { highlights: entry.highlights } : {}),
        ...(entry.content ? { content: entry.content } : {}),
        ...(entry.contributes ? { contributes: entry.contributes } : {}),
        versions: Object.fromEntries(
          Object.entries(entry.versions).map(([version, release]) => [
            version,
            {
              ...release,
              bundle: {
                ...release.bundle,
                downloadUrl: downloadUrlFor(entry.id, version),
              },
            },
          ]),
        ),
      },
    ]),
  );
  const targets = Object.fromEntries(
    normalized.flatMap((entry) =>
      Object.entries(entry.versions).map(([version, release]) => [
        `${entry.id}@${version}`,
        {
          pluginId: entry.id,
          version,
          originUrl: release.bundle.url,
          status:
            release.status ??
            (release.bundle.pending ? "pending" : entry.status),
        },
      ]),
    ),
  );
  return {
    index: {
      schemaVersion: 1,
      generatedAt,
      registries: {
        "lapis-official": {
          name: "Lapis Official Plugins",
          trustTier: "official",
        },
      },
      plugins: indexPlugins,
    },
    details,
    downloadTargets: {
      schemaVersion: 1,
      generatedAt,
      targets,
    },
    revoked: {
      schemaVersion: 1,
      generatedAt,
      revoked: [],
    },
  };
}

export function downloadUrlFor(pluginId, version) {
  return `../../download/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}`;
}

export function stripInternal(value) {
  if (Array.isArray(value)) {
    return value.map(stripInternal);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith("__") && key !== "$schema")
        .map(([key, child]) => [key, stripInternal(child)]),
    );
  }
  return value;
}

export function stableStringify(value, space = 0) {
  return JSON.stringify(sortJson(value), null, space);
}

export function canonicalize(value) {
  return stableStringify(value, 0);
}

export function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function signJson(value, privateKeyPem, keyId) {
  const payload = Buffer.from(canonicalize(value));
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKeyObject = createPublicKey(privateKey);
  const publicKey = publicKeyObject.export({
    type: "spki",
    format: "pem",
  });
  const publicKeyDer = publicKeyObject.export({
    type: "spki",
    format: "der",
  });
  const signature = sign(null, payload, privateKey).toString("base64");
  return {
    sidecar: { keyId, alg: "ed25519", sig: signature },
    publicKey,
    publicKeyRaw: Buffer.from(publicKeyDer).subarray(-32).toString("base64"),
  };
}

export function verifyJson(value, sidecar, publicKeyPem) {
  return verify(
    null,
    Buffer.from(canonicalize(value)),
    createPublicKey(publicKeyPem),
    Buffer.from(sidecar.sig, "base64"),
  );
}

export async function loadTrustRoot() {
  return readJson(new URL("trust/root.json", generatedDir));
}

export function publicKeyFor(root, keyId) {
  const key = root.keys.find((candidate) => candidate.keyId === keyId);
  if (!key) {
    throw new Error(`Unknown signing key ${keyId}`);
  }
  return key.publicKeyPem;
}
