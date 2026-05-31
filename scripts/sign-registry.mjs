#!/usr/bin/env node
import { promises as fs } from "node:fs";
import {
  generatedDir,
  readJson,
  signJson,
  stableStringify,
  writeJson,
} from "./lib/registry.mjs";

const keyId = process.env.LAPIS_REGISTRY_KEY_ID;
const privateKeyPem = process.env.LAPIS_REGISTRY_PRIVATE_KEY_PEM;

if (!keyId || !privateKeyPem) {
  console.error(
    "LAPIS_REGISTRY_KEY_ID and LAPIS_REGISTRY_PRIVATE_KEY_PEM are required.",
  );
  process.exit(1);
}

const targets = [
  "index.json",
  "revoked.json",
  ...(await fs.readdir(new URL("plugins/", generatedDir))).map(
    (name) => `plugins/${name}`,
  ),
].filter((name) => name.endsWith(".json"));

let publicKeyPem;
let publicKeyRaw;
for (const target of targets) {
  const targetUrl = new URL(target, generatedDir);
  const value = await readJson(targetUrl);
  const { signatures: _signatures, ...signedValue } = value;
  const signed = signJson(signedValue, privateKeyPem, keyId);
  publicKeyPem = signed.publicKey;
  publicKeyRaw = signed.publicKeyRaw;
  await writeJson(
    new URL(`${target.replace(/\.json$/, "")}.sig`, generatedDir),
    signed.sidecar,
  );
  await writeJson(targetUrl, { ...signedValue, signatures: [signed.sidecar] });
}

const rootUrl = new URL("trust/root.json", generatedDir);
let root = {
  schemaVersion: 1,
  generatedAt: "2026-05-31T00:00:00.000Z",
  keys: [],
  roles: { registry: [], release: [] },
};
try {
  root = await readJson(rootUrl);
} catch {
  // Created below.
}

root.keys = [
  ...root.keys.filter((key) => key.keyId !== keyId),
  { keyId, alg: "ed25519", publicKeyPem, publicKey: publicKeyRaw },
].sort((a, b) => a.keyId.localeCompare(b.keyId));
root.roles = {
  registry: [...new Set([...(root.roles?.registry ?? []), keyId])].sort(),
  release: root.roles?.release ?? [],
};
await fs.writeFile(rootUrl, `${stableStringify(root, 2)}\n`);

console.log(`Signed ${targets.length} registry metadata files with ${keyId}.`);
