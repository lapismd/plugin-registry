#!/usr/bin/env node
import { promises as fs } from "node:fs";
import {
  generatedDir,
  loadTrustRoot,
  publicKeyFor,
  readJson,
  verifyJson,
} from "./lib/registry.mjs";

const root = await loadTrustRoot();
const targets = [
  "index.json",
  "revoked.json",
  ...(await fs.readdir(new URL("plugins/", generatedDir))).map(
    (name) => `plugins/${name}`,
  ),
].filter((name) => name.endsWith(".json"));

const errors = [];
for (const target of targets) {
  const value = await readJson(new URL(target, generatedDir));
  const sidecarPath = target.replace(/\.json$/, ".sig");
  const sidecar = await readJson(new URL(sidecarPath, generatedDir));
  try {
    const publicKeyPem = publicKeyFor(root, sidecar.keyId);
    if (!verifyJson(value, sidecar, publicKeyPem)) {
      errors.push(`${sidecarPath}: invalid signature`);
    }
  } catch (error) {
    errors.push(`${sidecarPath}: ${error.message}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `Verified ${targets.length} registry metadata signature${targets.length === 1 ? "" : "s"}.`,
);
