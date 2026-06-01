import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const registryKeyMetadataFileName = "lapis-registry-key.json";
export const registryPrivateKeyFileName = "lapis-registry-private.pem";
export const registryPublicKeyFileName = "lapis-registry-public.pem";
export const registryPublicKeyRawFileName = "lapis-registry-public.raw.base64";

const pluginReleaseKeyMetadataFileName = "lapis-plugin-release-key.json";
const pluginReleasePrivateKeyFileName = "lapis-plugin-release-private.pem";
const pluginReleasePublicKeyFileName = "lapis-plugin-release-public.pem";

export function defaultLapisKeyDir(homeDir = homedir()) {
  return path.join(homeDir, ".lapis");
}

export function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

export function defaultRegistryKeyPaths(homeDir = homedir()) {
  const dir = defaultLapisKeyDir(homeDir);
  return {
    dir,
    metadataFile: path.join(dir, registryKeyMetadataFileName),
    privateKeyFile: path.join(dir, registryPrivateKeyFileName),
    publicKeyFile: path.join(dir, registryPublicKeyFileName),
    publicKeyRawFile: path.join(dir, registryPublicKeyRawFileName),
  };
}

export async function generateRegistryKey(options = {}) {
  const dir = path.resolve(expandHome(options.dir ?? defaultLapisKeyDir()));
  const paths = {
    dir,
    metadataFile: path.join(dir, registryKeyMetadataFileName),
    privateKeyFile: path.join(dir, registryPrivateKeyFileName),
    publicKeyFile: path.join(dir, registryPublicKeyFileName),
    publicKeyRawFile: path.join(dir, registryPublicKeyRawFileName),
  };
  const keyId =
    options.keyId ?? defaultRegistryKeyId(options.now ?? new Date());
  const force = Boolean(options.force);

  await mkdir(dir, { recursive: true });
  if (!force) {
    for (const file of [
      paths.metadataFile,
      paths.privateKeyFile,
      paths.publicKeyFile,
      paths.publicKeyRawFile,
    ]) {
      if (existsSync(file)) {
        throw new Error(
          `Refusing to replace existing registry key file: ${file}`,
        );
      }
    }
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const publicKeyRaw = publicKeyPemToRawBase64(publicKey);
  const metadata = {
    schemaVersion: 1,
    type: "lapis.registry.key",
    keyId,
    alg: "ed25519",
    privateKeyFile: registryPrivateKeyFileName,
    publicKeyFile: registryPublicKeyFileName,
    publicKeyRawFile: registryPublicKeyRawFileName,
    publicKey: publicKeyRaw,
    publicKeyPem: publicKey,
    createdAt: (options.now ?? new Date()).toISOString(),
  };

  await writeFile(paths.privateKeyFile, privateKey, { mode: 0o600 });
  await writeFile(paths.publicKeyFile, publicKey);
  await writeFile(paths.publicKeyRawFile, `${publicKeyRaw}\n`);
  await writeFile(paths.metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);

  return { ...paths, keyId, publicKeyRaw, publicKeyPem: publicKey, metadata };
}

export async function readDefaultRegistryKey(homeDir = homedir()) {
  const paths = defaultRegistryKeyPaths(homeDir);
  if (!existsSync(paths.metadataFile)) return null;
  const metadata = JSON.parse(await readFile(paths.metadataFile, "utf8"));
  const privateKeyFile = path.resolve(
    paths.dir,
    metadata.privateKeyFile ?? registryPrivateKeyFileName,
  );
  const publicKeyFile = path.resolve(
    paths.dir,
    metadata.publicKeyFile ?? registryPublicKeyFileName,
  );
  if (!existsSync(privateKeyFile)) {
    throw new Error(
      `Default registry key metadata exists but the private key is missing: ${privateKeyFile}`,
    );
  }
  if (!existsSync(publicKeyFile)) {
    throw new Error(
      `Default registry key metadata exists but the public key is missing: ${publicKeyFile}`,
    );
  }
  return {
    keyId: metadata.keyId,
    privateKeyFile,
    publicKeyFile,
    publicKeyRaw: metadata.publicKey,
    metadataFile: paths.metadataFile,
  };
}

export async function readDefaultPluginReleaseKey(homeDir = homedir()) {
  const dir = defaultLapisKeyDir(homeDir);
  const metadataFile = path.join(dir, pluginReleaseKeyMetadataFileName);
  if (!existsSync(metadataFile)) return null;
  const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
  const publicKeyFile = path.resolve(
    dir,
    metadata.publicKeyFile ?? pluginReleasePublicKeyFileName,
  );
  const privateKeyFile = path.resolve(
    dir,
    metadata.privateKeyFile ?? pluginReleasePrivateKeyFileName,
  );
  if (!existsSync(publicKeyFile)) {
    throw new Error(
      `Default plugin release key metadata exists but the public key is missing: ${publicKeyFile}`,
    );
  }
  return {
    keyId: metadata.keyId,
    publicKeyFile,
    privateKeyFile: existsSync(privateKeyFile) ? privateKeyFile : "",
    publicKeyRaw: metadata.publicKey,
    publicKeyPem:
      metadata.publicKeyPem ?? (await readFile(publicKeyFile, "utf8")),
    metadataFile,
  };
}

export async function resolveRegistrySigningKey(
  env = process.env,
  homeDir = homedir(),
) {
  if (env.LAPIS_REGISTRY_KEY_ID && env.LAPIS_REGISTRY_PRIVATE_KEY_PEM) {
    return {
      keyId: env.LAPIS_REGISTRY_KEY_ID,
      privateKeyPem: env.LAPIS_REGISTRY_PRIVATE_KEY_PEM,
      source: "env",
    };
  }
  const defaultKey = await readDefaultRegistryKey(homeDir);
  if (defaultKey) {
    return {
      keyId: defaultKey.keyId,
      privateKeyPem: await readFile(defaultKey.privateKeyFile, "utf8"),
      source: defaultKey.metadataFile,
    };
  }
  throw new Error(
    "LAPIS_REGISTRY_KEY_ID and LAPIS_REGISTRY_PRIVATE_KEY_PEM are required, or generate a local key with pnpm registry:keygen.",
  );
}

export function publicKeyPemToRawBase64(publicKeyPem) {
  const publicDer = createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der",
  });
  return Buffer.from(publicDer).subarray(-32).toString("base64");
}

export function privateKeyPemToPublicKeyPem(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: "spki",
    format: "pem",
  });
}

function defaultRegistryKeyId(now) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `lapis-registry-${year}-${month}`;
}
